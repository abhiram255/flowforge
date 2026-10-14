/**
 * MongoDB query benchmark: indexed vs unindexed latency on a workspace-scoped
 * task query — the exact shape FlowForge's board and "my tasks" views use.
 *
 * Reproduces a ~20k-document collection, measures p50/p95 latency plus
 * docsExamined for the same query before and after the compound index, and
 * writes a machine-readable result to docs/benchmark-results.json.
 *
 * Usage: npm run bench
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import mongoose, { Types } from 'mongoose'
import { connectDatabase, disconnectDatabase } from '../src/config/db'
import { env } from '../src/config/env'
import { logger } from '../src/config/logger'

const MONGO_URI = process.env.MONGODB_URI_BENCH ?? 'mongodb://127.0.0.1:27017/flowforge_bench'
const DOC_COUNT = 20_000
const ITERATIONS = 200
const WORKSPACES = 20
const PROJECTS_PER_WORKSPACE = 5
const STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done'] as const

interface Measurement {
  label: string
  p50Ms: number
  p95Ms: number
  p99Ms: number
  docsExamined: number
  keysExamined: number
  nReturned: number
  indexUsed: string | null
}

function percentile(sorted: number[], fraction: number): number {
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
  return Math.round((sorted[index] as number) * 1000) / 1000
}

function firstIndexName(plan: Record<string, unknown> | undefined): string | null {
  if (!plan) return null
  if (typeof plan.indexName === 'string') return plan.indexName
  const children = [plan.inputStage, plan.stage, plan.innerStage, plan.outerStage, plan.executionStages].filter(
    Boolean,
  ) as Array<Record<string, unknown>>
  for (const child of children) {
    if (child && typeof child === 'object' && 'stage' in child && !('inputStage' in child)) {
      const nested = firstIndexName(child)
      if (nested) return nested
      continue
    }
    const nested = firstIndexName(child)
    if (nested) return nested
  }
  return null
}

async function measure(
  db: mongoose.mongo.Db,
  collectionName: string,
  query: Record<string, unknown>,
  label: string,
): Promise<Measurement> {
  const collection = db.collection(collectionName)

  for (let warmup = 0; warmup < 25; warmup += 1) {
    await collection.find(query).sort({ position: 1 }).limit(100).toArray()
  }

  const samples: number[] = []
  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    const start = process.hrtime.bigint()
    await collection.find(query).sort({ position: 1 }).limit(100).toArray()
    samples.push(Number(process.hrtime.bigint() - start) / 1e6)
  }
  samples.sort((a, b) => a - b)

  // Explicit command so the win plan and execution counters are unambiguous.
  const explain = (await db.command({
    explain: { find: collectionName, filter: query, sort: { position: 1 }, limit: 100 },
    verbosity: 'executionStats',
  })) as unknown as {
    queryPlanner: { winningPlan: Record<string, unknown> }
    executionStats: { totalDocsExamined: number; totalKeysExamined: number; nReturned: number }
  }

  const stats = explain.executionStats
  if (stats.nReturned <= 0) {
    throw new Error(`benchmark query matched nothing (nReturned=${stats.nReturned}) — fix the dataset`)
  }

  return {
    label,
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    p99Ms: percentile(samples, 0.99),
    docsExamined: stats.totalDocsExamined,
    keysExamined: stats.totalKeysExamined,
    nReturned: stats.nReturned,
    indexUsed: firstIndexName(explain.queryPlanner.winningPlan),
  }
}

async function main(): Promise<void> {
  logger.info({ uri: MONGO_URI.replace(/\/\/.*@/, '//<redacted>@') }, 'benchmark: connecting')
  await connectDatabase(MONGO_URI)
  const db = mongoose.connection.db
  if (!db) throw new Error('database connection missing')

  const collection = db.collection('task_bench')
  await collection.drop().catch(() => undefined)

  logger.info({ documents: DOC_COUNT }, 'benchmark: generating dataset')
  const workspaceIds = Array.from({ length: WORKSPACES }, () => new Types.ObjectId())
  const projectIds = workspaceIds.flatMap((workspaceId) =>
    Array.from({ length: PROJECTS_PER_WORKSPACE }, () => ({
      workspaceId,
      projectId: new Types.ObjectId(),
    })),
  )
  const now = Date.now()

  const documents = Array.from({ length: DOC_COUNT }, (_, index) => {
    const project = projectIds[index % projectIds.length]!
    // Status must vary within a project (not be correlated with the project id),
    // otherwise a status-filtered query matches nothing and the benchmark lies.
    const round = Math.floor(index / projectIds.length)
    const status = STATUSES[(round + index) % STATUSES.length]
    return {
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      status,
      priority: ['low', 'medium', 'high', 'urgent'][index % 4],
      assigneeIds: [new Types.ObjectId()],
      position: index,
      createdAt: new Date(now - index * 1000),
      updatedAt: new Date(now - index * 1000),
      title: `Bench task ${index}`,
    }
  })

  const insertStart = process.hrtime.bigint()
  // Insert in batches to keep memory predictable.
  const BATCH = 2000
  for (let offset = 0; offset < documents.length; offset += BATCH) {
    await collection.insertMany(documents.slice(offset, offset + BATCH), { ordered: false })
  }
  const insertMs = Number(process.hrtime.bigint() - insertStart) / 1e6
  logger.info({ insertMs: Math.round(insertMs) }, 'benchmark: dataset inserted')

  const target = projectIds[Math.floor(projectIds.length / 2)]!
  const query = {
    workspaceId: target.workspaceId,
    projectId: target.projectId,
    status: 'todo',
  }

  const withoutIndex = await measure(db, 'task_bench', query, 'without compound index (collection scan)')

  await collection.createIndex({ workspaceId: 1, projectId: 1, status: 1, position: 1 })
  const withIndex = await measure(
    db,
    'task_bench',
    query,
    'with compound index {workspaceId, projectId, status, position}',
  )

  const speedup = withoutIndex.p95Ms / Math.max(withIndex.p95Ms, 0.001)
  const docsReduction = withoutIndex.docsExamined / Math.max(withIndex.docsExamined, 1)

  const report = {
    generatedAt: new Date().toISOString(),
    environment: {
      nodeVersion: process.version,
      platform: `${process.platform} ${process.arch}`,
      mongoUriDatabase: mongoose.connection.name,
      dataset: { documents: DOC_COUNT, workspaces: WORKSPACES, projects: projectIds.length },
      methodology: {
        iterations: ITERATIONS,
        warmupIterations: 25,
        query: 'find({workspaceId, projectId, status}).sort({position}).limit(100)',
        note:
          'p50/p95/p99 are wall-clock latencies of the driver call against a local single-node MongoDB. ' +
          'Not a production capacity claim — hardware and topology differ.',
      },
    },
    results: { withoutIndex, withIndex, p95SpeedupFactor: Math.round(speedup * 100) / 100, docsExaminedReductionFactor: Math.round(docsReduction * 100) / 100 },
  }

  const docsDir = path.resolve(env.apiRoot, '../../docs')
  await mkdir(docsDir, { recursive: true })
  await writeFile(
    path.join(docsDir, 'benchmark-results.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  )

  logger.info(
    {
      withoutIndex: { p50: withoutIndex.p50Ms, p95: withoutIndex.p95Ms, docsExamined: withoutIndex.docsExamined },
      withIndex: { p50: withIndex.p50Ms, p95: withIndex.p95Ms, docsExamined: withIndex.docsExamined },
      p95SpeedupFactor: report.results.p95SpeedupFactor,
    },
    'benchmark: results written to docs/benchmark-results.json',
  )

  await collection.drop().catch(() => undefined)
  await mongoose.connection.dropDatabase().catch(() => undefined)
  await disconnectDatabase()
}

main().catch((error) => {
  logger.error({ err: error }, 'benchmark failed')
  process.exit(1)
})
