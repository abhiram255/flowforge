/**
 * Experiment 8 — MongoDB replica set in the production topology.
 *
 * Sections (artifact: docs/experiments/exp8-mongo-replicaset.json):
 *
 *   1. Index build at scale: 200k tasks + 200k activity documents written to a
 *      scratch database on the replica set, then the one-shot `ensure-indexes`
 *      service builds every model's indexes (MONGODB_AUTO_INDEX=false in the
 *      prod stack) — build time is measured and the board query is verified to
 *      actually use the compound index via an explain plan.
 *   2. Failover drill: with load running through Traefik, the primary is
 *      stepped down (rs.stepDown) — client-visible errors, status-code mix and
 *      recovery window are measured from a 250 ms poller plus a bulk run.
 *   3. Analytics read preference A/B: aggregations on secondaries vs the
 *      primary (cache disabled in both arms so the database work actually
 *      happens on every request).
 *
 * Honesty caveat: single host — all mongod nodes, api replicas, Traefik and
 * the load generator share one CPU. Numbers describe this topology.
 */
import mongoose from 'mongoose'
import { Types } from 'mongoose'
import { TASK_STATUSES } from '@flowforge/shared'
import { logger } from '../../src/config/logger'
import {
  API_BASE,
  EXP_COMPOSE,
  EXP_DEV_COMPOSE,
  EXP_DEV_PRIMARY_COMPOSE,
  TRAEFIK_URL,
  composeUp,
  execCapture,
  mongosh,
  restoreProdTopology,
  runApiOneShot,
  runDetailed,
  waitForServiceHealthy,
  waitForTraefikConvergence,
} from './docker'
import { bootstrapDemoContext, sleep, writeArtifact } from './lib'

const SCRATCH_DB = 'flowforge_exp8scale'
const MONGO_DIRECT_URI = `mongodb://127.0.0.1:27018/${SCRATCH_DB}?directConnection=true&serverSelectionTimeoutMS=10000`
const TASK_COUNT = 200_000
const ACTIVITY_COUNT = 200_000
const WORKSPACES = 20
const PROJECTS_PER_WORKSPACE = 10
const USERS = 20
const MINUTE_MS = 60_000
const DAY_MS = 86_400_000

async function primaryContainer(): Promise<string> {
  const output = await mongosh(
    'flowforge-prod-mongo1-1',
    'rs.status().members.filter(m=>m.stateStr==="PRIMARY").map(m=>m.name).join(",")',
  )
  const host = output.trim().split(':')[0]
  return `flowforge-prod-${host}-1`
}

async function ensureMongo1IsPrimary(): Promise<string> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await primaryContainer()
    if (current === 'flowforge-prod-mongo1-1') return current
    logger.warn(`exp8: primary is ${current} — stepping down so mongo1 (priority 2) takes over`)
    await mongosh(current, 'rs.stepDown(15)')
    await sleep(4000)
  }
  throw new Error('could not move leadership to mongo1')
}

interface IndexBuildReport {
  collections: number
  totalMs: number
  perCollection: Array<{ collection: string; ms: number }>
  dataset: Record<string, unknown>
  explain: Record<string, unknown>
}

async function indexBuildAtScale(): Promise<IndexBuildReport> {
  await mongoose.connect(MONGO_DIRECT_URI)
  const db = mongoose.connection.db
  if (!db) throw new Error('scratch database connection missing')
  await db.dropDatabase()

  const tasks = db.collection('tasks')
  const activity = db.collection('activitylogs')

  const workspaceIds = Array.from({ length: WORKSPACES }, () => new Types.ObjectId())
  const userIds = Array.from({ length: USERS }, () => new Types.ObjectId())
  const projects = workspaceIds.flatMap((workspaceId) =>
    Array.from({ length: PROJECTS_PER_WORKSPACE }, () => ({
      workspaceId,
      projectId: new Types.ObjectId(),
    })),
  )
  const now = Date.now()
  const BATCH = 5000

  logger.warn(`exp8: inserting ${TASK_COUNT} tasks + ${ACTIVITY_COUNT} activity records (no indexes yet)`)
  const insertStart = Date.now()
  for (let offset = 0; offset < TASK_COUNT; offset += BATCH) {
    const batch = Array.from({ length: Math.min(BATCH, TASK_COUNT - offset) }, (_, index) => {
      const position = offset + index
      const project = projects[position % projects.length]!
      const round = Math.floor(position / projects.length)
      const status = TASK_STATUSES[(round + position) % TASK_STATUSES.length]!
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
      return {
        workspaceId: workspaceIds[position % WORKSPACES]!,
        actorId: userIds[position % USERS]!,
        action: 'task.updated',
        entityType: 'task',
        entityId: new Types.ObjectId(),
        createdAt: new Date(now - position * MINUTE_MS),
      }
    })
    await activity.insertMany(batch, { ordered: false })
  }
  const insertMs = Date.now() - insertStart

  // The one-shot service the prod stack uses to build indexes (autoIndex is off).
  const output = await runApiOneShot(
    EXP_COMPOSE,
    ['node', 'apps/api/dist/scripts/ensure-indexes.js'],
    {
      MONGODB_URI: `mongodb://mongo1:27017,mongo2:27017,mongo3:27017/${SCRATCH_DB}?replicaSet=rs0`,
    },
  )
  const doneLine = output
    .split(/\r?\n/)
    .filter((line) => line.includes('ensure-indexes: done'))
    .pop()
  if (!doneLine) throw new Error(`ensure-indexes output unparseable:\n${output}`)
  const parsed = JSON.parse(doneLine) as {
    collections: number
    totalMs: number
    results: Array<{ collection: string; ms: number }>
  }

  // Verify the compound board index is actually chosen at 200k documents.
  const target = projects[Math.floor(projects.length / 2)]!
  const explain = await db.command({
    explain: {
      find: 'tasks',
      filter: { workspaceId: target.workspaceId, projectId: target.projectId, status: 'todo' },
      sort: { position: 1 },
      limit: 100,
    },
    verbosity: 'executionStats',
  })
  const stages: string[] = []
  let cursor = explain.queryPlanner?.winningPlan
  let indexName: string | null = null
  while (cursor) {
    stages.push(String(cursor.stage))
    if (cursor.indexName) indexName = String(cursor.indexName)
    cursor = cursor.inputStage ?? cursor.inputStages?.[0]
  }
  const stats = explain.executionStats ?? {}

  await db.dropDatabase()
  await mongoose.disconnect()

  return {
    collections: parsed.collections,
    totalMs: parsed.totalMs,
    perCollection: parsed.results,
    dataset: { tasks: TASK_COUNT, activity: ACTIVITY_COUNT, insertMs },
    explain: {
      stages,
      indexUsed: indexName,
      docsExamined: stats.totalDocsExamined ?? null,
      keysExamined: stats.totalKeysExamined ?? null,
      nReturned: stats.nReturned ?? null,
      executionTimeMillis: stats.executionTimeMillis ?? null,
    },
  }
}

// ---------------------------------------------------------------------------
// Failover drill
// ---------------------------------------------------------------------------

interface Poll {
  at: number
  status: number
  ms: number
}

async function failoverDrill(
  token: string,
  projectId: string,
): Promise<Record<string, unknown>> {
  const primaryBefore = await primaryContainer()
  const boardUrl = `${API_BASE}/projects/${projectId}/tasks?sort=position`

  // Primary watcher: records every leadership transition during the drill.
  const transitions: Array<{ at: number; primary: string }> = []
  let watching = true
  const watcher = (async () => {
    while (watching) {
      try {
        const primary = await primaryContainer()
        if (transitions.at(-1)?.primary !== primary) transitions.push({ at: Date.now(), primary })
      } catch {
        /* transient during election */
      }
      await sleep(1000)
    }
  })()

  // Read-path poller (250 ms cadence).
  const polls: Poll[] = []
  let stop = false
  const poller = (async () => {
    while (!stop) {
      const started = Date.now()
      let status = 0
      try {
        const response = await fetch(boardUrl, { headers: { authorization: `Bearer ${token}` } })
        status = response.status
        await response.arrayBuffer()
      } catch {
        status = 0
      }
      polls.push({ at: started, status, ms: Date.now() - started })
      await sleep(250)
    }
  })()

  // Write-path probe: one versioned task create every 500 ms (retryWrites=true).
  const writeStatuses: number[] = []
  let writing = true
  const writer = (async () => {
    while (writing) {
      try {
        const response = await fetch(`${API_BASE}/projects/${projectId}/tasks`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ title: `Failover write probe ${Date.now()}` }),
        })
        writeStatuses.push(response.status)
        await response.arrayBuffer()
      } catch {
        writeStatuses.push(0)
      }
      await sleep(500)
    }
  })()

  const loadPromise = runDetailed('board @30 during primary stepDown', boardUrl, token, 30, 40)
  await sleep(8000)
  logger.warn(`exp8: stepping down primary ${primaryBefore}`)
  const stepDownAt = Date.now()
  const stepDownOutput = (await mongosh(primaryBefore, 'rs.stepDown(25)')).trim()
  const bulk = await loadPromise
  stop = true
  writing = false
  watching = false
  await Promise.all([poller, writer, watcher])

  const failures = polls.filter((poll) => poll.status !== 200)
  const latencies = polls.map((poll) => poll.ms).sort((a, b) => a - b)
  const firstFailure = failures[0]
  const lastFailure = failures.at(-1)
  const firstSuccessAfterFailures =
    lastFailure && polls.find((poll) => poll.at > lastFailure.at && poll.status === 200)
  const statusHistogram = polls.reduce<Record<string, number>>((acc, poll) => {
    acc[String(poll.status)] = (acc[String(poll.status)] ?? 0) + 1
    return acc
  }, {})
  const writeHistogram = writeStatuses.reduce<Record<string, number>>((acc, status) => {
    acc[String(status)] = (acc[String(status)] ?? 0) + 1
    return acc
  }, {})

  await sleep(3000)
  const rsSummary = await mongosh(
    'flowforge-prod-mongo1-1',
    'rs.status().members.map(m=>m.name+"="+m.stateStr).join(",")',
  )
  const readiness = await fetch(`${TRAEFIK_URL}/api/v1/health/ready`)

  return {
    primaryBefore,
    leadershipSequence: transitions.map((entry) => ({
      primary: entry.primary,
      atOffsetMs: entry.at - stepDownAt,
    })),
    leadershipMoved: transitions.some((entry) => entry.primary !== primaryBefore),
    stepDownOutput: stepDownOutput || '(no output)',
    rsMembersAfter: rsSummary.trim(),
    stepDownAtOffsetMs: stepDownAt - (polls[0]?.at ?? stepDownAt),
    readPath: {
      polls: polls.length,
      failures: failures.length,
      statusHistogram,
      latencyMs: {
        p50: latencies[Math.floor(latencies.length * 0.5)] ?? null,
        p97: latencies[Math.floor(latencies.length * 0.97)] ?? null,
        max: latencies.at(-1) ?? null,
      },
      firstFailureAfterStepDownMs: firstFailure ? firstFailure.at - stepDownAt : null,
      recoveryMs:
        firstFailure && firstSuccessAfterFailures
          ? firstSuccessAfterFailures.at - firstFailure.at
          : null,
    },
    writePath: {
      writes: writeStatuses.length,
      statusHistogram: writeHistogram,
    },
    bulk: {
      requestsPerSecond: bulk.requestsPerSecond,
      latencyMs: bulk.latencyMs,
      totalRequests: bulk.totalRequests,
      non2xx: bulk.non2xx,
      connectionErrors: bulk.errors,
      statusCodeStats: bulk.statusCodeStats,
    },
    readinessAfter: readiness.status,
  }
}

// ---------------------------------------------------------------------------
// Analytics read-preference A/B (cache disabled in both arms)
// ---------------------------------------------------------------------------

async function readPreferenceArm(
  label: string,
  files: string[],
  token: string,
  workspaceId: string,
): Promise<Record<string, unknown>> {
  await composeUp(files, 3)
  await waitForServiceHealthy('api', 3, 240_000, files)
  await waitForTraefikConvergence()
  const scenario = await runDetailed(
    `analytics @30 (${label})`,
    `${API_BASE}/workspaces/${workspaceId}/analytics?range=30`,
    token,
    30,
    12,
  )
  return { label, scenario }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  logger.warn('exp8: replica-set experiment (scratch dataset + failover + read preference)')

  await composeUp(EXP_COMPOSE, 3)
  await waitForServiceHealthy('api', 3)
  await waitForTraefikConvergence()
  await runApiOneShot(EXP_COMPOSE, ['node', 'apps/api/dist/scripts/seed.js'], {
    SEED_FORCE: 'true',
  })
  const ctx = await bootstrapDemoContext(API_BASE)

  logger.warn('exp8/1: index build at 400k documents')
  await ensureMongo1IsPrimary()
  const indexBuild = await indexBuildAtScale()

  logger.warn('exp8/2: failover drill under load')
  const failover = await failoverDrill(ctx.token, ctx.projectId)

  logger.warn('exp8/3: analytics read preference A/B')
  const secondaryPreferred = await readPreferenceArm(
    'secondaryPreferred',
    EXP_DEV_COMPOSE,
    ctx.token,
    ctx.workspaceId,
  )
  const primary = await readPreferenceArm(
    'primary',
    EXP_DEV_PRIMARY_COMPOSE,
    ctx.token,
    ctx.workspaceId,
  )

  logger.warn('exp8: restoring the production topology (3 replicas)')
  await restoreProdTopology(3)

  const dockerVersion = (
    await execCapture('flowforge-prod-api-1', ['node', '-e', "process.stdout.write(process.version)"])
  ).trim()

  const artifact = {
    experiment: 'exp8-mongo-replicaset',
    generatedAt: new Date().toISOString(),
    environment: {
      nodeInContainer: dockerVersion,
      topology: '3-node MongoDB replica set (rs0) inside docker-compose.prod.yml',
      caveat:
        'Single host: mongod nodes, Traefik, api replicas and the load generator share one CPU. Numbers describe this topology.',
      scratchDatabase: SCRATCH_DB,
    },
    indexBuildAtScale: indexBuild,
    failover,
    readPreference: { secondaryPreferred, primary },
  }
  const target = await writeArtifact('exp8-mongo-replicaset.json', artifact)
  logger.warn(`exp8: artifact written to ${target}`)

  // Leave the production stack healthy.
  await restoreProdTopology(3)
  await waitForServiceHealthy('api', 3)
}

main().catch((error) => {
  logger.error({ err: error }, 'exp8 failed')
  process.exit(1)
})
