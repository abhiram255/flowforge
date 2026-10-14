/**
 * Experiment 2 — Database scaling.
 *
 * Seeds 200,000 tasks + 200,000 activity records into a scratch database and
 * measures the application's real query shapes before and after the index set
 * the app creates, plus skip-based vs cursor pagination at depth.
 *
 * All measurements come from `explain` executionStats (docsExamined /
 * keysExamined / nReturned) and wall-clock driver timings.
 *
 * Usage: tsx scripts/experiments/exp2-database.ts
 */
import os from 'node:os'
import mongoose, { Types } from 'mongoose'
import { connectDatabase, disconnectDatabase } from '../../src/config/db'
import { logger } from '../../src/config/logger'
import { writeArtifact } from './lib'

const MONGO_URI = process.env.MONGODB_URI_EXP2 ?? 'mongodb://127.0.0.1:27017/flowforge_exp2'
const TASK_COUNT = 200_000
const ACTIVITY_COUNT = 200_000
const WORKSPACES = 4
const PROJECTS_PER_WORKSPACE = 5
const USERS = 8
const STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done'] as const
const MINUTE_MS = 60_000
const DAY_MS = 86_400_000

/** The index set the application creates after the scalability pass. */
const APP_INDEXES = [
  { name: 'board', keys: { workspaceId: 1, projectId: 1, status: 1, position: 1 } },
  { name: 'mine', keys: { workspaceId: 1, assigneeIds: 1, status: 1, dueDate: 1 } },
  { name: 'cursor', keys: { workspaceId: 1, createdAt: -1, _id: -1 } },
  { name: 'completed', keys: { workspaceId: 1, status: 1, completedAt: -1 } },
  { name: 'dueDate', keys: { workspaceId: 1, dueDate: 1 } },
] as const

interface Timed {
  label: string
  iterations: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  docsExamined: number | null
  keysExamined: number | null
  nReturned: number | null
  indexUsed: string | null
}

const percentile = (sorted: number[], fraction: number): number =>
  Math.round(
    (sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] as number) * 1000,
  ) / 1000

function winningIndexName(plan: Record<string, unknown> | undefined): string | null {
  if (!plan) return null
  if (typeof plan.indexName === 'string') return plan.indexName as string
  if (plan.stage === 'COLLSCAN') return 'COLLSCAN'
  for (const key of ['inputStage', 'innerStage', 'outerStage', 'stage', 'executionStages']) {
    const child = plan[key]
    if (child && typeof child === 'object') {
      const found = winningIndexName(child as Record<string, unknown>)
      if (found) return found
    }
  }
  return null
}

async function explainFind(
  db: mongoose.mongo.Db,
  collection: string,
  filter: Record<string, unknown>,
  sort: Record<string, 1 | -1>,
  limit: number,
  skip?: number,
): Promise<{
  docsExamined: number | null
  keysExamined: number | null
  nReturned: number | null
  indexUsed: string | null
}> {
  const command: Record<string, unknown> = { find: collection, filter, sort, limit }
  if (skip) command.skip = skip
  const explain = (await db.command({
    explain: command,
    verbosity: 'executionStats',
  })) as unknown as {
    queryPlanner: { winningPlan: Record<string, unknown> }
    executionStats: { totalDocsExamined: number; totalKeysExamined: number; nReturned: number }
  }
  return {
    docsExamined: explain.executionStats.totalDocsExamined,
    keysExamined: explain.executionStats.totalKeysExamined,
    nReturned: explain.executionStats.nReturned,
    indexUsed: winningIndexName(explain.queryPlanner.winningPlan),
  }
}

async function measureFind(
  db: mongoose.mongo.Db,
  label: string,
  collection: string,
  filter: Record<string, unknown>,
  sort: Record<string, 1 | -1>,
  limit: number,
  iterations: number,
  skip?: number,
): Promise<Timed> {
  const coll = db.collection(collection)
  for (let index = 0; index < 5; index += 1) {
    await coll
      .find(filter)
      .sort(sort)
      .skip(skip ?? 0)
      .limit(limit)
      .toArray()
  }
  const samples: number[] = []
  for (let index = 0; index < iterations; index += 1) {
    const start = process.hrtime.bigint()
    await coll
      .find(filter)
      .sort(sort)
      .skip(skip ?? 0)
      .limit(limit)
      .toArray()
    samples.push(Number(process.hrtime.bigint() - start) / 1e6)
  }
  samples.sort((a, b) => a - b)
  const stats = await explainFind(db, collection, filter, sort, limit, skip)
  return {
    label,
    iterations,
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    p99Ms: percentile(samples, 0.99),
    ...stats,
  }
}

async function measureOp(
  label: string,
  iterations: number,
  fn: () => Promise<unknown>,
): Promise<Timed> {
  for (let index = 0; index < 3; index += 1) await fn()
  const samples: number[] = []
  for (let index = 0; index < iterations; index += 1) {
    const start = process.hrtime.bigint()
    await fn()
    samples.push(Number(process.hrtime.bigint() - start) / 1e6)
  }
  samples.sort((a, b) => a - b)
  return {
    label,
    iterations,
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    p99Ms: percentile(samples, 0.99),
    docsExamined: null,
    keysExamined: null,
    nReturned: null,
    indexUsed: null,
  }
}

async function main(): Promise<void> {
  await connectDatabase(MONGO_URI)
  const db = mongoose.connection.db
  if (!db) throw new Error('database connection missing')

  const tasks = db.collection('task_scale')
  const activity = db.collection('activity_scale')
  await tasks.drop().catch(() => undefined)
  await activity.drop().catch(() => undefined)

  const workspaceIds = Array.from({ length: WORKSPACES }, () => new Types.ObjectId())
  const userIds = Array.from({ length: USERS }, () => new Types.ObjectId())
  const projects = workspaceIds.flatMap((workspaceId) =>
    Array.from({ length: PROJECTS_PER_WORKSPACE }, () => ({
      workspaceId,
      projectId: new Types.ObjectId(),
    })),
  )
  const now = Date.now()

  logger.warn(
    `exp2: inserting ${TASK_COUNT} tasks + ${ACTIVITY_COUNT} activity records (no indexes yet)`,
  )
  const insertStart = process.hrtime.bigint()
  const BATCH = 5000
  for (let offset = 0; offset < TASK_COUNT; offset += BATCH) {
    const batch = Array.from({ length: Math.min(BATCH, TASK_COUNT - offset) }, (_, index) => {
      const position = offset + index
      const project = projects[position % projects.length]!
      const round = Math.floor(position / projects.length)
      const status = STATUSES[(round + position) % STATUSES.length]!
      const createdAt = new Date(now - position * MINUTE_MS)
      return {
        workspaceId: project.workspaceId,
        projectId: project.projectId,
        key: `T-${position}`,
        title: `Scaled task ${position}`,
        description: `Description for scaled task ${position} — realistic payload size for the board benchmark.`,
        status,
        priority: ['low', 'medium', 'high', 'urgent'][position % 4],
        assigneeIds: [userIds[position % USERS]!],
        reporterId: userIds[(position + 1) % USERS]!,
        labels: ['load', 'bench'],
        dueDate: new Date(now + ((position % 60) - 30) * DAY_MS),
        position,
        version: 0,
        completedAt: status === 'done' ? createdAt : null,
        createdAt,
        updatedAt: createdAt,
      }
    })
    await tasks.insertMany(batch, { ordered: false })
  }
  for (let offset = 0; offset < ACTIVITY_COUNT; offset += BATCH) {
    const batch = Array.from({ length: Math.min(BATCH, ACTIVITY_COUNT - offset) }, (_, index) => {
      const position = offset + index
      const workspaceId = workspaceIds[position % WORKSPACES]!
      return {
        workspaceId,
        actorId: userIds[position % USERS]!,
        action: 'task.updated',
        entityType: 'task',
        entityId: new Types.ObjectId(),
        createdAt: new Date(now - position * MINUTE_MS),
      }
    })
    await activity.insertMany(batch, { ordered: false })
  }
  const insertMs = Math.round(Number(process.hrtime.bigint() - insertStart) / 1e6)
  logger.warn(`exp2: dataset inserted in ${insertMs} ms`)

  const target = projects[Math.floor(projects.length / 2)]!
  const myUser = userIds[3]!
  const sevenDaysAgo = new Date(now - 7 * DAY_MS)
  const deepOffset = Math.floor(TASK_COUNT / WORKSPACES / 2)
  const cursorDoc = await tasks
    .find({ workspaceId: target.workspaceId })
    .sort({ createdAt: -1, _id: -1 })
    .skip(deepOffset)
    .limit(1)
    .toArray()
  const cursor = cursorDoc[0]!

  const paginationCursorFilter = {
    workspaceId: target.workspaceId,
    $or: [
      { createdAt: { $lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, _id: { $lt: cursor._id } },
    ],
  }

  const shapes = {
    board: {
      filter: { workspaceId: target.workspaceId, projectId: target.projectId, status: 'todo' },
      sort: { position: 1 } as Record<string, 1 | -1>,
      limit: 100,
    },
    myTasks: {
      filter: { workspaceId: target.workspaceId, assigneeIds: myUser, status: { $ne: 'done' } },
      sort: { updatedAt: -1 } as Record<string, 1 | -1>,
      limit: 8,
    },
    overdueCount: {
      filter: {
        workspaceId: target.workspaceId,
        status: { $ne: 'done' },
        dueDate: { $ne: null, $lt: new Date(now) },
      },
      sort: { dueDate: 1 } as Record<string, 1 | -1>,
      limit: 25,
    },
    completedThisWeek: {
      filter: {
        workspaceId: target.workspaceId,
        status: 'done',
        completedAt: { $gte: sevenDaysAgo },
      },
      sort: { completedAt: -1 } as Record<string, 1 | -1>,
      limit: 25,
    },
    deepSkip: {
      filter: { workspaceId: target.workspaceId },
      sort: { createdAt: -1, _id: -1 } as Record<string, 1 | -1>,
      limit: 25,
      skip: deepOffset,
    },
    cursorPage: {
      filter: paginationCursorFilter as Record<string, unknown>,
      sort: { createdAt: -1, _id: -1 } as Record<string, 1 | -1>,
      limit: 25,
    },
  }

  const iterations = 20
  const measureAll = async (): Promise<Record<string, Timed>> => {
    const board = await measureFind(
      db,
      'board read (indexed sort, limit 100)',
      'task_scale',
      shapes.board.filter,
      shapes.board.sort,
      shapes.board.limit,
      iterations,
    )
    const myTasks = await measureFind(
      db,
      '"my tasks" (assignee + status, limit 8)',
      'task_scale',
      shapes.myTasks.filter,
      shapes.myTasks.sort,
      shapes.myTasks.limit,
      iterations,
    )
    const overdue = await measureFind(
      db,
      'overdue count shape (workspace, not done, due date)',
      'task_scale',
      shapes.overdueCount.filter,
      shapes.overdueCount.sort,
      shapes.overdueCount.limit,
      iterations,
    )
    const completed = await measureFind(
      db,
      'completed-this-week (workspace, done, completedAt)',
      'task_scale',
      shapes.completedThisWeek.filter,
      shapes.completedThisWeek.sort,
      shapes.completedThisWeek.limit,
      iterations,
    )
    const skip = await measureFind(
      db,
      `deep pagination — skip(${deepOffset / 1000}k)`,
      'task_scale',
      shapes.deepSkip.filter,
      shapes.deepSkip.sort,
      shapes.deepSkip.limit,
      10,
      shapes.deepSkip.skip,
    )
    const cursored = await measureFind(
      db,
      'deep pagination — cursor',
      'task_scale',
      shapes.cursorPage.filter,
      shapes.cursorPage.sort,
      shapes.cursorPage.limit,
      20,
    )

    const cycleTime = await measureOp('cycle-time aggregation (done tasks)', 10, () =>
      tasks
        .aggregate([
          {
            $match: { workspaceId: target.workspaceId, status: 'done', completedAt: { $ne: null } },
          },
          {
            $project: {
              hours: { $divide: [{ $subtract: ['$completedAt', '$createdAt'] }, 3_600_000] },
            },
          },
          { $group: { _id: null, avgHours: { $avg: '$hours' } } },
        ])
        .toArray(),
    )

    const activityFeed = await measureFind(
      db,
      'activity feed (workspace, newest first)',
      'activity_scale',
      { workspaceId: target.workspaceId },
      { createdAt: -1, _id: -1 },
      25,
      iterations,
    )

    return {
      board,
      myTasks,
      overdue,
      completed,
      deepSkip: skip,
      cursorPage: cursored,
      cycleTime,
      activityFeed,
    }
  }

  logger.warn('exp2: measuring WITHOUT application indexes')
  const withoutIndexes = await measureAll()

  logger.warn('exp2: building the application index set')
  const buildStart = Date.now()
  for (const index of APP_INDEXES) {
    await tasks.createIndex(index.keys as Record<string, 1 | -1>, { name: index.name })
  }
  await activity.createIndex({ workspaceId: 1, createdAt: -1, _id: -1 }, { name: 'feed' })
  const indexBuildMs = Date.now() - buildStart

  logger.warn('exp2: measuring WITH application indexes')
  const withIndexes = await measureAll()

  const comparisons = Object.keys(withIndexes).map((key) => {
    const before = withoutIndexes[key] as Timed
    const after = withIndexes[key] as Timed
    return {
      query: before.label,
      p95BeforeMs: before.p95Ms,
      p95AfterMs: after.p95Ms,
      p95Speedup: Math.round((before.p95Ms / Math.max(after.p95Ms, 0.001)) * 100) / 100,
      docsExaminedBefore: before.docsExamined,
      docsExaminedAfter: after.docsExamined,
      docsExaminedReduction:
        before.docsExamined && after.docsExamined
          ? Math.round((before.docsExamined / Math.max(after.docsExamined, 1)) * 100) / 100
          : null,
      indexUsed: after.indexUsed,
    }
  })

  const artifact = {
    experiment: 2,
    generatedAt: new Date().toISOString(),
    environment: {
      machine: `${os.cpus()[0]?.model} (${os.cpus().length} logical cores)`,
      node: process.version,
      mongodb: mongoose.connection.name,
      dataset: {
        tasks: TASK_COUNT,
        activityRecords: ACTIVITY_COUNT,
        workspaces: WORKSPACES,
        projects: projects.length,
        documents: TASK_COUNT + ACTIVITY_COUNT,
      },
      indexBuildMs,
      methodology:
        'Raw driver queries against a scratch database with the application query shapes. explain ' +
        'executionStats supplies docsExamined / keysExamined / nReturned; p50/p95/p99 are wall-clock ' +
        'driver timings (20 iterations, 5 warmups, 10 for the deep-skip shape). "Without indexes" runs ' +
        'before any index exists (collection scans); "with indexes" runs after the application index set is built.',
    },
    indexSet: APP_INDEXES,
    withoutIndexes,
    withIndexes,
    comparisons,
  }

  const target0 = await writeArtifact('exp2-database.json', artifact)
  logger.warn(`exp2: artifact written to ${target0}`)

  for (const comparison of comparisons) {
    logger.warn(
      `exp2: ${comparison.query} → p95 ${comparison.p95BeforeMs}ms → ${comparison.p95AfterMs}ms (${comparison.p95Speedup}×), docsExamined ${comparison.docsExaminedBefore} → ${comparison.docsExaminedAfter}`,
    )
  }

  await tasks.drop().catch(() => undefined)
  await activity.drop().catch(() => undefined)
  await mongoose.connection.dropDatabase().catch(() => undefined)
  await disconnectDatabase()
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error({ err: error }, 'exp2 failed')
    process.exit(1)
  })
