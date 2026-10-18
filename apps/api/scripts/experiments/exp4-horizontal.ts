/**
 * Experiment 4 — Horizontal scaling.
 *
 * Runs the same load scenarios against (a) one API instance and (b) two API
 * instances behind a round-robin load balancer with active health checks.
 * Measures throughput, latency, error rate and per-instance CPU, then proves the
 * two shared-state questions:
 *   - rate limiting is a *shared* budget across instances (Redis store), and
 *   - realtime events fan out across instances (Socket.IO Redis adapter).
 *
 * Usage: tsx scripts/experiments/exp4-horizontal.ts
 */
import os from 'node:os'
import IORedis from 'ioredis'
import { io as ioClient, type Socket } from 'socket.io-client'
import { connectDatabase, disconnectDatabase } from '../../src/config/db'
import { logger } from '../../src/config/logger'
import { seedDatabase } from '../../src/scripts/seed'
import {
  bootstrapDemoContext,
  cpuPercent,
  dropDatabase,
  login,
  runScenario,
  RoundRobinBalancer,
  scrapeMetrics,
  sleep,
  startApiInstance,
  writeArtifact,
  type MetricsSnapshot,
  type ScenarioResult,
} from './lib'

const MONGO_URI = process.env.MONGODB_URI_EXP4 ?? 'mongodb://127.0.0.1:27017/flowforge_exp4'
const REDIS_URL = process.env.REDIS_URL_EXP ?? 'redis://127.0.0.1:6379'
const A_PORT = 43201
const B_PORT = 43202
const LB_PORT = 43200
const LIMIT_A_PORT = 43211
const LIMIT_B_PORT = 43212
const LIMIT_LB_PORT = 43210
const NOSYNC_E_PORT = 43221
const NOSYNC_F_PORT = 43222

const metricDelta = (before: number | null, after: number | null): number | null =>
  before === null || after === null ? null : after - before

/** The shared limiter keeps counters in Redis for 15 minutes; start from zero. */
async function clearRateLimitKeys(redis: IORedis): Promise<number> {
  const keys: string[] = []
  const stream = redis.scanStream({ match: 'ff:rl:*', count: 200 })
  for await (const chunk of stream) keys.push(...(chunk as string[]))
  if (keys.length > 0) await redis.del(...keys)
  return keys.length
}

async function waitForEvent(
  socket: Socket,
  event: string,
  timeoutMs: number,
): Promise<number | null> {
  const started = Date.now()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off(event, handler)
      resolve(null)
    }, timeoutMs)
    const handler = (): void => {
      clearTimeout(timer)
      resolve(Date.now() - started)
    }
    socket.once(event, handler)
  })
}

async function connectObserver(url: string, token: string): Promise<Socket> {
  const socket = ioClient(url, { auth: { token }, transports: ['websocket'], reconnection: true })
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket connect timeout')), 8000)
    socket.once('connect', () => {
      clearTimeout(timer)
      resolve()
    })
    socket.once('connect_error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
  return socket
}

async function main(): Promise<void> {
  const redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: 2 })
  await redis.ping()

  logger.warn('exp4: seeding dataset')
  await connectDatabase(MONGO_URI)
  await seedDatabase({ reset: true, scale: 4 })
  await disconnectDatabase()

  const instanceA = await startApiInstance({
    name: 'api-a',
    port: A_PORT,
    mongoUri: MONGO_URI,
    redisUrl: REDIS_URL,
  })
  const instanceB = await startApiInstance({
    name: 'api-b',
    port: B_PORT,
    mongoUri: MONGO_URI,
    redisUrl: REDIS_URL,
  })
  const balancer = new RoundRobinBalancer({
    port: LB_PORT,
    upstreams: [
      { name: 'api-a', port: A_PORT },
      { name: 'api-b', port: B_PORT },
    ],
  })
  await balancer.listen()

  const horizontal: Array<Record<string, unknown>> = []
  try {
    const demo = await bootstrapDemoContext(instanceA.baseUrl)
    const paths = {
      board: `/api/v1/projects/${demo.projectId}/tasks?sort=position`,
      dashboard: `/api/v1/workspaces/${demo.workspaceId}/analytics/dashboard`,
    }

    const scenarios = [
      { key: 'board', connections: 50 },
      { key: 'board', connections: 100 },
      { key: 'dashboard', connections: 50 },
      { key: 'dashboard', connections: 100 },
    ] as const

    for (const scenario of scenarios) {
      const path = paths[scenario.key]
      const durationSeconds = 10

      // Single instance (direct to A)
      const singleBefore: MetricsSnapshot = await scrapeMetrics(instanceA)
      const startedSingle = Date.now()
      const singleResult = await runScenario(instanceA, {
        name: `single instance — ${scenario.key} @ ${scenario.connections}`,
        url: `${instanceA.rootUrl}${path}`,
        token: demo.token,
        connections: scenario.connections,
        durationSeconds,
      })
      const singleAfter = await scrapeMetrics(instanceA)

      // Two instances behind the load balancer
      const dualBeforeA = await scrapeMetrics(instanceA)
      const dualBeforeB = await scrapeMetrics(instanceB)
      const startedDual = Date.now()
      const dualResult = await runScenario(balancer, {
        name: `two instances — ${scenario.key} @ ${scenario.connections}`,
        url: `${balancer.url}${path}`,
        token: demo.token,
        connections: scenario.connections,
        durationSeconds,
      })
      const dualAfterA = await scrapeMetrics(instanceA)
      const dualAfterB = await scrapeMetrics(instanceB)
      const wallMs = Date.now() - startedDual

      horizontal.push({
        scenario: `${scenario.key} @ ${scenario.connections} concurrent`,
        single: {
          ...singleResult,
          cpuPercentOfOneCore: cpuPercent(singleBefore, singleAfter, Date.now() - startedSingle),
        },
        twoInstances: {
          ...dualResult,
          perInstance: {
            'api-a': {
              requestsServed: metricDelta(
                dualBeforeA.httpRequestsTotal,
                dualAfterA.httpRequestsTotal,
              ),
              cpuPercentOfOneCore: cpuPercent(dualBeforeA, dualAfterA, wallMs),
            },
            'api-b': {
              requestsServed: metricDelta(
                dualBeforeB.httpRequestsTotal,
                dualAfterB.httpRequestsTotal,
              ),
              cpuPercentOfOneCore: cpuPercent(dualBeforeB, dualAfterB, wallMs),
            },
          },
          balancer: balancer.snapshot(),
        },
        throughputGain:
          Math.round(
            (dualResult.requestsPerSecond / Math.max(singleResult.requestsPerSecond, 1)) * 100,
          ) / 100,
      })
      logger.warn(
        `exp4: ${scenario.key}@${scenario.connections} → single ${singleResult.requestsPerSecond} rps (p95 ${singleResult.latencyMs.p97_5}ms) vs two instances ${dualResult.requestsPerSecond} rps (p95 ${dualResult.latencyMs.p97_5}ms), errors ${dualResult.errors + dualResult.non2xx}`,
      )
    }

    // ------------------------------------------------------------------
    // Shared rate-limit budget across instances
    // ------------------------------------------------------------------
    const limitA = await startApiInstance({
      name: 'limit-a',
      port: LIMIT_A_PORT,
      mongoUri: MONGO_URI,
      redisUrl: REDIS_URL,
      env: { RATE_LIMIT_DISABLED: 'false' },
    })
    const limitB = await startApiInstance({
      name: 'limit-b',
      port: LIMIT_B_PORT,
      mongoUri: MONGO_URI,
      redisUrl: REDIS_URL,
      env: { RATE_LIMIT_DISABLED: 'false' },
    })
    const limitBalancer = new RoundRobinBalancer({
      port: LIMIT_LB_PORT,
      upstreams: [
        { name: 'limit-a', port: LIMIT_A_PORT },
        { name: 'limit-b', port: LIMIT_B_PORT },
      ],
    })
    await limitBalancer.listen()

    let allowed = 0
    let throttled = 0
    const clearedLimitKeys = await clearRateLimitKeys(redis)
    const beforeLimitA = await scrapeMetrics(limitA)
    const beforeLimitB = await scrapeMetrics(limitB)
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const response = await fetch(`${limitBalancer.url}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'aarav.mehta@flowforge.dev', password: 'wrong-password' }),
      })
      if (response.status === 429) throttled += 1
      else allowed += 1
    }
    const afterLimitA = await scrapeMetrics(limitA)
    const afterLimitB = await scrapeMetrics(limitB)
    const rateLimit = {
      requestsSent: 60,
      credentialLimitPerWindow: 30,
      windowMinutes: 15,
      clearedStaleCounters: clearedLimitKeys,
      allowed,
      throttled,
      expectedWithSharedStore: 30,
      expectedWithPerInstanceStores: 60,
      servedBy: {
        'limit-a': metricDelta(beforeLimitA.httpRequestsTotal, afterLimitA.httpRequestsTotal),
        'limit-b': metricDelta(beforeLimitB.httpRequestsTotal, afterLimitB.httpRequestsTotal),
      },
      verdict: allowed === 30 ? 'shared budget across instances' : 'per-instance budget',
    }
    logger.warn(
      `exp4: shared rate limit → allowed ${allowed}/60, throttled ${throttled}/60 (${rateLimit.verdict})`,
    )
    await limitBalancer.close()
    await limitA.stopGracefully()
    await limitB.stopGracefully()

    // ------------------------------------------------------------------
    // Realtime fan-out: with the Redis adapter vs without
    // ------------------------------------------------------------------
    const taskResponse = (await (
      await fetch(`${instanceA.baseUrl}/projects/${demo.projectId}/tasks?sort=position`, {
        headers: { authorization: `Bearer ${demo.token}` },
      })
    ).json()) as { data: Array<{ id: string; version: number; title: string }> }
    const probe = taskResponse.data[0]!

    const withAdapter = await (async () => {
      const socket = await connectObserver(instanceA.rootUrl, demo.token)
      await new Promise<void>((resolve) =>
        socket.emit('workspace:join', { workspaceId: demo.workspaceId }, () => resolve()),
      )
      const waiting = waitForEvent(socket, 'task:updated', 4000)
      await fetch(`${instanceB.baseUrl}/tasks/${probe.id}`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${demo.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          title: `${probe.title} (cross-instance check)`,
          version: probe.version,
        }),
      })
      const latencyMs = await waiting
      socket.close()
      // restore title/version for later checks
      const refreshed = (await (
        await fetch(`${instanceB.baseUrl}/tasks/${probe.id}`, {
          headers: { authorization: `Bearer ${demo.token}` },
        })
      ).json()) as { version: number; title: string }
      await fetch(`${instanceB.baseUrl}/tasks/${probe.id}`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${demo.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ title: probe.title, version: refreshed.version }),
      })
      return { received: latencyMs !== null, latencyMs }
    })()

    const noSync = await (async () => {
      const instanceE = await startApiInstance({
        name: 'nosync-e',
        port: NOSYNC_E_PORT,
        mongoUri: MONGO_URI,
        redisUrl: null,
      })
      const instanceF = await startApiInstance({
        name: 'nosync-f',
        port: NOSYNC_F_PORT,
        mongoUri: MONGO_URI,
        redisUrl: null,
      })
      try {
        const token = await login(instanceE.baseUrl)
        const task = (await (
          await fetch(`${instanceE.baseUrl}/projects/${demo.projectId}/tasks?sort=position`, {
            headers: { authorization: `Bearer ${token}` },
          })
        ).json()) as { data: Array<{ id: string; version: number; title: string }> }
        const target = task.data[1]!
        const socket = await connectObserver(instanceE.rootUrl, token)
        await new Promise<void>((resolve) =>
          socket.emit('workspace:join', { workspaceId: demo.workspaceId }, () => resolve()),
        )
        const waiting = waitForEvent(socket, 'task:updated', 2500)
        await fetch(`${instanceF.baseUrl}/tasks/${target.id}`, {
          method: 'PATCH',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            title: `${target.title} (no-adapter check)`,
            version: target.version,
          }),
        })
        const latencyMs = await waiting
        socket.close()
        return {
          received: latencyMs !== null,
          latencyMs,
          note: 'expected: not received without a shared adapter',
        }
      } finally {
        await instanceE.stopGracefully()
        await instanceF.stopGracefully()
      }
    })()

    logger.warn(
      `exp4: realtime fan-out with adapter=${withAdapter.received} (${withAdapter.latencyMs}ms), without adapter=${noSync.received}`,
    )

    const artifact = {
      experiment: 4,
      generatedAt: new Date().toISOString(),
      environment: {
        machine: `${os.cpus()[0]?.model} (${os.cpus().length} logical cores)`,
        node: process.version,
        apiInstances:
          'two child processes behind a round-robin HTTP proxy with 1s health checks and one retry on connection failure for idempotent requests',
        redis:
          'docker redis:7-alpine shared by both instances (cache, queues, rate-limit store, Socket.IO adapter)',
        mongodb: 'local single-node MongoDB shared by both instances',
        methodology:
          'Same autocannon scenarios in both configurations; rate limiting disabled except in the dedicated shared-budget ' +
          'check, which uses the credential limiter (30 requests / 15 min) with two instances and no RATE_LIMIT_DISABLED. ' +
          "Per-instance CPU and request counts come from each process's /metrics endpoint. Health checks add ~1 rps per " +
          'instance to the request counters.',
      },
      results: horizontal,
      sharedRateLimit: rateLimit,
      realtimeFanOut: { withRedisAdapter: withAdapter, withoutRedisAdapter: noSync },
    }

    const target = await writeArtifact('exp4-horizontal.json', artifact)
    logger.warn(`exp4: artifact written to ${target}`)
  } finally {
    await balancer.close()
    await instanceA.stopGracefully()
    await instanceB.stopGracefully()
    await redis.quit().catch(() => undefined)
    await sleep(300)
  }

  await dropDatabase(MONGO_URI)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error({ err: error }, 'exp4 failed')
    process.exit(1)
  })

export type { ScenarioResult }
