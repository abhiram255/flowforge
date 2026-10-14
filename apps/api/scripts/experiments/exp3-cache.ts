/**
 * Experiment 3 — Caching.
 *
 * Measures the Redis-backed read-through cache on the analytics and dashboard
 * endpoints: cache hit ratio under load, latency with vs without the cache,
 * single-flight behaviour when many requests hit a cold key at once, and data
 * freshness (invalidation on writes + TTL bounds when the database changes
 * behind the API's back).
 *
 * Usage: tsx scripts/experiments/exp3-cache.ts
 */
import { Agent, request as httpRequest } from 'node:http'
import os from 'node:os'
import IORedis from 'ioredis'
import mongoose from 'mongoose'
import { connectDatabase, disconnectDatabase } from '../../src/config/db'
import { logger } from '../../src/config/logger'
import { seedDatabase } from '../seed'
import {
  bootstrapDemoContext,
  dropDatabase,
  runScenario,
  scrapeMetrics,
  sleep,
  startApiInstance,
  writeArtifact,
} from './lib'

const MONGO_URI = process.env.MONGODB_URI_EXP3 ?? 'mongodb://127.0.0.1:27017/flowforge_exp3'
const REDIS_URL = process.env.REDIS_URL_EXP ?? 'redis://127.0.0.1:6379'
const PORT_CACHED = 43111
const PORT_UNCACHED = 43112
const BURST = 50

const agent = new Agent({ keepAlive: true, maxSockets: 200 })

interface BurstResponse {
  status: number
  body: string
}

/** Fires `count` genuinely parallel GETs over pre-opened sockets. */
function parallelGet(
  url: string,
  headers: Record<string, string>,
  count: number,
): Promise<BurstResponse[]> {
  return Promise.all(
    Array.from(
      { length: count },
      () =>
        new Promise<BurstResponse>((resolve, reject) => {
          const req = httpRequest(url, { method: 'GET', headers, agent }, (res) => {
            const chunks: Buffer[] = []
            res.on('data', (chunk: Buffer) => chunks.push(chunk))
            res.on('end', () =>
              resolve({
                status: res.statusCode ?? 0,
                body: Buffer.concat(chunks).toString('utf8'),
              }),
            )
          })
          req.on('error', reject)
          req.end()
        }),
    ),
  )
}

async function bustWorkspaceCaches(redis: IORedis, workspaceId: string): Promise<number> {
  const keys: string[] = []
  for (const pattern of [
    `ff:analytics:${workspaceId}:*`,
    `ff:dashboard:${workspaceId}:*`,
    `ff:usersmini:${workspaceId}*`,
  ]) {
    const stream = redis.scanStream({ match: pattern, count: 200 })
    for await (const chunk of stream) keys.push(...(chunk as string[]))
  }
  if (keys.length > 0) await redis.del(...keys)
  return keys.length
}

/** Prometheus omits zero-valued labelled series, so absent means zero. */
const delta = (before: number | null, after: number | null): number | null => {
  if (before === null && after === null) return null
  return (after ?? 0) - (before ?? 0)
}

interface AnalyticsBody {
  analytics?: { generatedAt?: string; overview?: { completedTasks?: number } }
}
interface DashboardBody {
  dashboard?: { myCompletedThisWeek?: number }
}

async function main(): Promise<void> {
  const redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: 2 })
  await redis.ping()

  logger.warn('exp3: seeding dataset')
  await connectDatabase(MONGO_URI)
  await seedDatabase({ reset: true, scale: 4 })
  await disconnectDatabase()

  const cached = await startApiInstance({
    name: 'api-cached',
    port: PORT_CACHED,
    mongoUri: MONGO_URI,
    redisUrl: REDIS_URL,
  })
  const uncached = await startApiInstance({
    name: 'api-cache-disabled',
    port: PORT_UNCACHED,
    mongoUri: MONGO_URI,
    redisUrl: REDIS_URL,
    env: { CACHE_DISABLED: 'true' },
  })

  try {
    const demo = await bootstrapDemoContext(cached.baseUrl)
    const headers = { authorization: `Bearer ${demo.token}` }
    const dashboardUrl = `${cached.baseUrl}/workspaces/${demo.workspaceId}/analytics/dashboard`
    const analyticsUrl = `${cached.baseUrl}/workspaces/${demo.workspaceId}/analytics?range=30`
    const uncachedAnalyticsUrl = `${uncached.baseUrl}/workspaces/${demo.workspaceId}/analytics?range=30`

    // Pre-open sockets so the stampede is real concurrency, not connection setup.
    await parallelGet(analyticsUrl, headers, 5)

    // ------------------------------------------------------------------
    // 1. Cold-key stampede — 50 parallel requests on a deleted key
    // ------------------------------------------------------------------
    const bustedKeys = await bustWorkspaceCaches(redis, demo.workspaceId)
    const beforeStampede = await scrapeMetrics(cached)
    const stampedeStart = Date.now()
    const responses = await parallelGet(analyticsUrl, headers, BURST)
    const stampedeWallMs = Date.now() - stampedeStart
    const afterStampede = await scrapeMetrics(cached)
    const parsed = responses.map((response) => {
      try {
        return JSON.parse(response.body) as AnalyticsBody
      } catch {
        return {} as AnalyticsBody
      }
    })
    const distinctPayloads = new Set(
      parsed.map((entry) => entry.analytics?.generatedAt ?? 'missing'),
    ).size
    const stampede = {
      concurrentRequests: responses.length,
      allOk: responses.every((response) => response.status === 200),
      wallMs: stampedeWallMs,
      producerRuns: delta(beforeStampede.cacheMisses, afterStampede.cacheMisses),
      coalescedWaiters: delta(beforeStampede.cacheCoalesced, afterStampede.cacheCoalesced),
      cacheHits: delta(beforeStampede.cacheHits, afterStampede.cacheHits),
      distinctPayloads,
      bustedKeys,
    }
    logger.warn(
      `exp3: cold stampede → ${stampede.wallMs}ms, producers=${stampede.producerRuns}, coalesced=${stampede.coalescedWaiters}, distinct payloads=${stampede.distinctPayloads}`,
    )

    // ------------------------------------------------------------------
    // 2. Same stampede with the cache disabled (no coalescing)
    // ------------------------------------------------------------------
    const beforeUncached = await scrapeMetrics(uncached)
    const uncachedStart = Date.now()
    const uncachedResponses = await parallelGet(uncachedAnalyticsUrl, headers, BURST)
    const uncachedWallMs = Date.now() - uncachedStart
    const afterUncached = await scrapeMetrics(uncached)
    const uncachedStampede = {
      concurrentRequests: uncachedResponses.length,
      allOk: uncachedResponses.every((response) => response.status === 200),
      wallMs: uncachedWallMs,
      producerRuns: delta(beforeUncached.cacheMisses, afterUncached.cacheMisses),
      coalescedWaiters: delta(beforeUncached.cacheCoalesced, afterUncached.cacheCoalesced),
    }
    logger.warn(
      `exp3: cold stampede with cache disabled → ${uncachedStampede.wallMs}ms, producers=${uncachedStampede.producerRuns}`,
    )

    // ------------------------------------------------------------------
    // 3. Warm cache under load (hit ratio + latency), and without the cache
    // ------------------------------------------------------------------
    const warmScenarios = []
    for (const scenario of [
      { name: 'dashboard @ 50 concurrent (warm cache)', url: dashboardUrl, connections: 50 },
      { name: 'analytics @ 50 concurrent (warm cache)', url: analyticsUrl, connections: 50 },
    ]) {
      const before = await scrapeMetrics(cached)
      const result = await runScenario(cached, {
        name: scenario.name,
        url: scenario.url,
        token: demo.token,
        connections: scenario.connections,
        durationSeconds: 10,
      })
      const after = await scrapeMetrics(cached)
      const hits = delta(before.cacheHits, after.cacheHits)
      const misses = delta(before.cacheMisses, after.cacheMisses)
      warmScenarios.push({
        ...result,
        cacheHits: hits,
        cacheMisses: misses,
        hitRatio:
          hits !== null && misses !== null && hits + misses > 0
            ? Math.round((hits / (hits + misses)) * 1000) / 1000
            : null,
      })
    }

    const uncachedScenarios = []
    for (const scenario of [
      { name: 'dashboard @ 50 concurrent (cache disabled)', url: dashboardUrl, connections: 50 },
      { name: 'analytics @ 50 concurrent (cache disabled)', url: analyticsUrl, connections: 50 },
    ]) {
      const result = await runScenario(uncached, {
        name: scenario.name,
        url: scenario.url,
        token: demo.token,
        connections: scenario.connections,
        durationSeconds: 10,
      })
      uncachedScenarios.push(result)
    }

    // ------------------------------------------------------------------
    // 4. Freshness — a write through the API invalidates immediately
    // ------------------------------------------------------------------
    const analyticsBeforeWrite = (await (
      await fetch(analyticsUrl, { headers })
    ).json()) as AnalyticsBody
    const tasksResponse = (await (
      await fetch(`${cached.baseUrl}/projects/${demo.projectId}/tasks?sort=position`, { headers })
    ).json()) as { data: Array<{ id: string; status: string; version: number }> }
    const openTask = tasksResponse.data.find((task) => task.status !== 'done')
    if (!openTask) throw new Error('no open task available for the freshness test')

    const writeResponse = await fetch(`${cached.baseUrl}/tasks/${openTask.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'done', version: openTask.version }),
    })
    if (!writeResponse.ok) throw new Error(`freshness write failed: ${writeResponse.status}`)
    const writeAt = Date.now()
    const analyticsAfterWrite = (await (
      await fetch(analyticsUrl, { headers })
    ).json()) as AnalyticsBody
    const invalidationLatencyMs = Date.now() - writeAt
    const beforeCount = analyticsBeforeWrite.analytics?.overview?.completedTasks
    const afterCount = analyticsAfterWrite.analytics?.overview?.completedTasks
    const invalidation = {
      completedBefore: beforeCount ?? null,
      completedAfter: afterCount ?? null,
      freshImmediately:
        beforeCount !== undefined && afterCount !== undefined && afterCount === beforeCount + 1,
      latencyMs: invalidationLatencyMs,
    }
    logger.warn(
      `exp3: write invalidation → fresh in ${invalidation.latencyMs}ms (${invalidation.completedBefore} → ${invalidation.completedAfter})`,
    )

    // ------------------------------------------------------------------
    // 5. Freshness — TTL bound when the database changes behind the cache
    // ------------------------------------------------------------------
    // The TTL clock starts when these warming requests write the cache entries.
    const ttlStart = Date.now()
    await fetch(dashboardUrl, { headers })
    await fetch(analyticsUrl, { headers })
    const dashBefore = ((await (await fetch(dashboardUrl, { headers })).json()) as DashboardBody)
      .dashboard?.myCompletedThisWeek
    const analyticsBaseline = (
      (await (await fetch(analyticsUrl, { headers })).json()) as AnalyticsBody
    ).analytics?.overview?.completedTasks

    await connectDatabase(MONGO_URI)
    const rawDb = mongoose.connection.db
    if (!rawDb) throw new Error('script-side database connection missing')
    const userDoc = await rawDb.collection('users').findOne({ email: 'aarav.mehta@flowforge.dev' })
    const victim = await rawDb
      .collection('tasks')
      .findOneAndUpdate(
        { assigneeIds: userDoc?._id, status: { $ne: 'done' } },
        { $set: { status: 'done', completedAt: new Date() } },
        { returnDocument: 'after' },
      )
    if (!victim?._id) throw new Error('no task available for the TTL test')

    const ttlWindowStart = ttlStart
    let dashboardStalenessSeconds: number | null = null
    let analyticsStalenessSeconds: number | null = null
    while (Date.now() - ttlWindowStart < 75_000) {
      if (dashboardStalenessSeconds === null) {
        const dashboard = ((await (await fetch(dashboardUrl, { headers })).json()) as DashboardBody)
          .dashboard
        if (dashboard?.myCompletedThisWeek !== dashBefore) {
          dashboardStalenessSeconds = Math.round((Date.now() - ttlWindowStart) / 1000)
        }
      }
      if (analyticsStalenessSeconds === null) {
        const analytics = ((await (await fetch(analyticsUrl, { headers })).json()) as AnalyticsBody)
          .analytics
        if (analytics?.overview?.completedTasks !== analyticsBaseline) {
          analyticsStalenessSeconds = Math.round((Date.now() - ttlWindowStart) / 1000)
        }
      }
      if (dashboardStalenessSeconds !== null && analyticsStalenessSeconds !== null) break
      await sleep(1000)
    }
    await rawDb
      .collection('tasks')
      .updateOne({ _id: victim._id }, { $set: { status: 'todo', completedAt: null } })
    await disconnectDatabase()

    const ttl = {
      dashboardTtlSeconds: 20,
      analyticsTtlSeconds: 60,
      observedDashboardStalenessSeconds: dashboardStalenessSeconds,
      observedAnalyticsStalenessSeconds: analyticsStalenessSeconds,
      note:
        'A write through the API invalidates immediately (measured above); a direct database write cannot invalidate, ' +
        'so the cached value is served until its TTL expires — the observed staleness must stay within the TTL.',
    }
    logger.warn(
      `exp3: TTL bound → dashboard ${dashboardStalenessSeconds}s (≤20s), analytics ${analyticsStalenessSeconds}s (≤60s)`,
    )

    const artifact = {
      experiment: 3,
      generatedAt: new Date().toISOString(),
      environment: {
        machine: `${os.cpus()[0]?.model} (${os.cpus().length} logical cores)`,
        node: process.version,
        cache: 'Redis 7.4 (docker), read-through cache in apps/api/src/lib/cache.ts',
        ttl: 'analytics 60s, dashboard 20s, workspace member minis 30s; all invalidated on workspace writes',
        methodology:
          'Two API child processes share one MongoDB and one Redis: one with the cache enabled, one with ' +
          'CACHE_DISABLED=true (dev-only flag, refused in production). Cache counters are Prometheus counters ' +
          'scraped from /metrics; hit ratio = hits / (hits + misses) over each scenario. The cold-key burst uses ' +
          `${BURST} genuinely parallel HTTP/1.1 requests over pre-opened sockets (node:http agent) after deleting the workspace keys in Redis.`,
      },
      coldStampede: stampede,
      coldStampedeCacheDisabled: uncachedStampede,
      warmCache: warmScenarios,
      cacheDisabledComparison: uncachedScenarios,
      freshness: { writeInvalidation: invalidation, ttlBound: ttl },
    }

    const target = await writeArtifact('exp3-cache.json', artifact)
    logger.warn(`exp3: artifact written to ${target}`)
  } finally {
    agent.destroy()
    await cached.stopGracefully()
    await uncached.stopGracefully()
    await redis.quit().catch(() => undefined)
  }

  await dropDatabase(MONGO_URI)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error({ err: error }, 'exp3 failed')
    process.exit(1)
  })
