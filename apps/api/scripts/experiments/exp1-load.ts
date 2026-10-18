/**
 * Experiment 1 — API load testing.
 *
 * Simulates 10/50/100 concurrent users hitting the three primary read paths
 * (board tasks, project list, dashboard) plus task detail, cached analytics and
 * the write path. The API runs as a real child process; autocannon runs here, in
 * the parent, so CPU numbers are the server's own.
 *
 * Usage:
 *   tsx scripts/experiments/exp1-load.ts --label baseline
 *   tsx scripts/experiments/exp1-load.ts --label after --redis
 */
import os from 'node:os'
import { connectDatabase, disconnectDatabase } from '../../src/config/db'
import { logger } from '../../src/config/logger'
import { seedDatabase } from '../../src/scripts/seed'
import {
  bootstrapDemoContext,
  dropDatabase,
  runScenario,
  scrapeMetrics,
  startApiInstance,
  writeArtifact,
  type ScenarioResult,
} from './lib'

const args = process.argv.slice(2)
const label = args.includes('--label') ? (args[args.indexOf('--label') + 1] as string) : 'run'
const useRedis = args.includes('--redis')
const PORT = 43101
const MONGO_URI = process.env.MONGODB_URI_EXP1 ?? 'mongodb://127.0.0.1:27017/flowforge_exp1'
const REDIS_URL = 'redis://127.0.0.1:6379'

async function main(): Promise<void> {
  logger.warn(`exp1[${label}]: seeding dataset (scale=4) into ${MONGO_URI}`)
  await connectDatabase(MONGO_URI)
  await seedDatabase({ reset: true, scale: 4 })
  await disconnectDatabase()

  const instance = await startApiInstance({
    name: `api-${label}`,
    port: PORT,
    mongoUri: MONGO_URI,
    redisUrl: useRedis ? REDIS_URL : null,
  })

  try {
    const demo = await bootstrapDemoContext(instance.baseUrl)
    const base = instance.baseUrl

    // Payload shaping: board responses omit `description` (up to 20k chars per
    // task). Measure the actual response and the description bytes it no longer
    // carries, straight from the database.
    const boardResponse = await fetch(`${base}/projects/${demo.projectId}/tasks?sort=position`, {
      headers: { authorization: `Bearer ${demo.token}` },
    })
    const boardBody = (await boardResponse.json()) as { data: Array<Record<string, unknown>> }
    const boardPayloadBytes = Buffer.byteLength(JSON.stringify(boardBody))
    const tasksWithoutDescription = boardBody.data.filter(
      (task) => task.description === undefined,
    ).length

    const mongoose = await import('mongoose')
    await mongoose.default.connect(MONGO_URI)
    const descriptionRows = (await mongoose.default.connection
      .db!.collection('tasks')
      .aggregate([
        { $match: { projectId: new mongoose.default.Types.ObjectId(demo.projectId) } },
        {
          $group: {
            _id: null,
            bytes: { $sum: { $strLenBytes: { $ifNull: ['$description', ''] } } },
          },
        },
      ])
      .toArray()) as Array<{ bytes: number }>
    await mongoose.default.disconnect()
    const descriptionBytesInDb = descriptionRows[0]?.bytes ?? 0
    const payload = {
      boardTasks: boardBody.data.length,
      boardPayloadBytes,
      tasksWithoutDescription,
      descriptionBytesInDb,
      estimatedBaselinePayloadBytes: boardPayloadBytes + descriptionBytesInDb,
      reductionPercent:
        boardPayloadBytes + descriptionBytesInDb > 0
          ? Math.round((descriptionBytesInDb / (boardPayloadBytes + descriptionBytesInDb)) * 1000) /
            10
          : null,
      note: 'Uncompressed JSON of the board response; the estimate adds back the description bytes stored for the same project.',
    }
    logger.warn(
      `exp1[${label}]: board payload ${boardPayloadBytes} bytes, descriptions dropped ${descriptionBytesInDb} bytes (${payload.reductionPercent}%), tasks without description ${tasksWithoutDescription}/${boardBody.data.length}`,
    )

    const scenarios: Array<{
      name: string
      url: string
      connections: number
      method?: 'GET' | 'POST'
      body?: string
    }> = [
      {
        name: 'board task list — 10 concurrent',
        url: `${base}/projects/${demo.projectId}/tasks?sort=position`,
        connections: 10,
      },
      {
        name: 'board task list — 50 concurrent',
        url: `${base}/projects/${demo.projectId}/tasks?sort=position`,
        connections: 50,
      },
      {
        name: 'board task list — 100 concurrent',
        url: `${base}/projects/${demo.projectId}/tasks?sort=position`,
        connections: 100,
      },
      {
        name: 'project list — 10 concurrent',
        url: `${base}/workspaces/${demo.workspaceId}/projects`,
        connections: 10,
      },
      {
        name: 'project list — 50 concurrent',
        url: `${base}/workspaces/${demo.workspaceId}/projects`,
        connections: 50,
      },
      {
        name: 'project list — 100 concurrent',
        url: `${base}/workspaces/${demo.workspaceId}/projects`,
        connections: 100,
      },
      {
        name: 'dashboard — 10 concurrent',
        url: `${base}/workspaces/${demo.workspaceId}/analytics/dashboard`,
        connections: 10,
      },
      {
        name: 'dashboard — 50 concurrent',
        url: `${base}/workspaces/${demo.workspaceId}/analytics/dashboard`,
        connections: 50,
      },
      {
        name: 'dashboard — 100 concurrent',
        url: `${base}/workspaces/${demo.workspaceId}/analytics/dashboard`,
        connections: 100,
      },
      {
        name: 'analytics (cached 60s) — 50 concurrent',
        url: `${base}/workspaces/${demo.workspaceId}/analytics?range=30`,
        connections: 50,
      },
      {
        name: 'task detail (counts) — 50 concurrent',
        url: `${base}/tasks/${demo.taskId}`,
        connections: 50,
      },
      {
        name: 'task creation (write path) — 20 concurrent',
        url: `${base}/projects/${demo.projectId}/tasks`,
        connections: 20,
        method: 'POST' as const,
        body: JSON.stringify({ title: 'Load generated task', priority: 'medium' }),
      },
    ]

    const before = await scrapeMetrics(instance)
    const results: ScenarioResult[] = []
    for (const scenario of scenarios) {
      logger.warn(`exp1[${label}]: ${scenario.name}`)
      const result = await runScenario(instance, {
        name: scenario.name,
        url: scenario.url,
        token: demo.token,
        connections: scenario.connections,
        durationSeconds: 10,
        method: scenario.method,
        body: scenario.body,
      })
      results.push(result)
      logger.warn(
        `exp1[${label}]: → ${result.requestsPerSecond} rps | p50 ${result.latencyMs.p50}ms | p95 ${result.latencyMs.p97_5}ms | p99 ${result.latencyMs.p99}ms | errors ${result.errors + result.non2xx} | cpu ${result.cpuPercentOfOneCore ?? 'n/a'}%`,
      )
    }
    const after = await scrapeMetrics(instance)

    const health = await (await fetch(`${base}/health`)).json()

    const artifact = {
      experiment: 1,
      label,
      generatedAt: new Date().toISOString(),
      environment: {
        machine: `${os.cpus()[0]?.model} (${os.cpus().length} logical cores)`,
        totalMemoryGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
        node: process.version,
        platform: `${process.platform} ${process.arch}`,
        apiInstances: 1,
        mongodb: 'local 8.x single node (127.0.0.1:27017), database flowforge_exp1',
        redis: useRedis
          ? 'docker redis:7-alpine (127.0.0.1:6379)'
          : 'not used (in-process cache + inline jobs)',
        health,
        methodology:
          'autocannon (10s per scenario, pipelining 1) against one API child process and a local single-node ' +
          'MongoDB on the same machine; the load generator shares the CPU. Rate limiting disabled for the run ' +
          '(dev-only flag, refused in production). CPU is the API process itself, from /metrics ' +
          'process_cpu_seconds_total. Seeded demo dataset at scale=4 (~200 tasks across 4 projects).',
      },
      cacheCounters: {
        hits:
          before.cacheHits !== null && after.cacheHits !== null
            ? after.cacheHits - before.cacheHits
            : null,
        misses:
          before.cacheMisses !== null && after.cacheMisses !== null
            ? after.cacheMisses - before.cacheMisses
            : null,
        coalesced:
          before.cacheCoalesced !== null && after.cacheCoalesced !== null
            ? after.cacheCoalesced - before.cacheCoalesced
            : null,
      },
      payload,
      results,
    }

    const target = await writeArtifact(`exp1-${label}.json`, artifact)
    logger.warn(`exp1[${label}]: artifact written to ${target}`)
  } finally {
    await instance.stopGracefully()
  }

  await dropDatabase(MONGO_URI)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error({ err: error }, `exp1[${label}] failed`)
    process.exit(1)
  })
