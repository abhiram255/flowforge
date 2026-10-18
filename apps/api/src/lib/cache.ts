import { env } from '../config/env'
import { getCacheBackend, getRedisClient } from '../config/redis'
import { cacheCoalescedTotal, cacheHitsTotal, cacheMissesTotal } from './metrics'

interface MemoryEntry {
  value: string
  expiresAt: number
}

const memoryStore = new Map<string, MemoryEntry>()

/**
 * In-flight producers keyed by cache key. On a cold key, concurrent requests
 * join the existing producer instead of every one of them stampeding the
 * database (measured in Experiment 3). This is per-process by design: with N
 * replicas a cold key can still be computed up to N times, which is the
 * accepted bound (a distributed lock would add a fail-open polling path and a
 * latency tax on every cold key to save at most N-1 producers).
 */
const inflight = new Map<string, Promise<unknown>>()

const namespaceOf = (key: string): string => key.split(':')[1] ?? 'other'

/**
 * A cached `null` is a real answer ("no such workspace", "not a member") and
 * must be distinguishable from a miss — otherwise every 404 re-hits Mongo.
 * Producers in this codebase never legitimately return this exact object.
 */
const NULL_SENTINEL = '{"__ffNull":true}'

function encode(value: unknown): string {
  if (value === null || value === undefined) return NULL_SENTINEL
  return JSON.stringify(value)
}

function decode(raw: string): unknown {
  if (raw === NULL_SENTINEL) return null
  return JSON.parse(raw) as unknown
}

/**
 * Downward-only TTL jitter (0.9–1.0×) so replicas stop expiring the same key
 * at the same instant, while the documented staleness bounds stay true.
 */
function jitteredTtl(ttlSeconds: number): number {
  return Math.max(1, Math.round(ttlSeconds * (0.9 + Math.random() * 0.1)))
}

/** Sweep expired entries and evict oldest-inserted ones beyond the cap. */
function sweepMemoryStore(now: number): void {
  for (const [key, entry] of memoryStore) {
    if (entry.expiresAt <= now) memoryStore.delete(key)
  }
  const overflow = memoryStore.size - env.CACHE_MEMORY_MAX_ENTRIES
  if (overflow <= 0) return
  let removed = 0
  for (const key of memoryStore.keys()) {
    memoryStore.delete(key)
    removed += 1
    if (removed >= overflow) break
  }
}

let memoryWrites = 0
const MEMORY_SWEEP_EVERY = 100

interface ReadResult {
  hit: boolean
  value: unknown
}

async function read(key: string): Promise<ReadResult> {
  const redis = getRedisClient()
  if (redis) {
    try {
      const raw = await redis.get(key)
      if (raw === null) return { hit: false, value: null }
      return { hit: true, value: decode(raw) }
    } catch {
      return { hit: false, value: null }
    }
  }
  const entry = memoryStore.get(key)
  if (!entry) return { hit: false, value: null }
  if (entry.expiresAt < Date.now()) {
    memoryStore.delete(key)
    return { hit: false, value: null }
  }
  return { hit: true, value: decode(entry.value) }
}

async function write(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const raw = encode(value)
  const ttl = jitteredTtl(ttlSeconds)
  const redis = getRedisClient()
  if (redis) {
    try {
      await redis.set(key, raw, 'EX', ttl)
    } catch {
      /* cache writes are best-effort */
    }
    return
  }
  memoryStore.set(key, { value: raw, expiresAt: Date.now() + ttl * 1000 })
  memoryWrites += 1
  // Sweep-on-write keeps the fallback bounded without timers (nothing to unref,
  // nothing that keeps test workers alive).
  if (memoryWrites % MEMORY_SWEEP_EVERY === 0) sweepMemoryStore(Date.now())
}

async function get<T>(key: string): Promise<T | null> {
  const { hit, value } = await read(key)
  if (!hit) return null
  cacheHitsTotal.inc({ namespace: namespaceOf(key) })
  return value as T
}

async function set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  await write(key, value, ttlSeconds)
}

async function del(key: string): Promise<void> {
  const redis = getRedisClient()
  if (redis) {
    try {
      await redis.del(key)
    } catch {
      /* best-effort */
    }
    return
  }
  memoryStore.delete(key)
}

async function delPrefix(prefix: string): Promise<void> {
  const redis = getRedisClient()
  if (redis) {
    try {
      const stream = redis.scanStream({ match: `${prefix}*`, count: 100 })
      const keys: string[] = []
      for await (const chunk of stream) {
        keys.push(...(chunk as string[]))
      }
      if (keys.length > 0) await redis.del(...keys)
    } catch {
      /* best-effort */
    }
    return
  }
  for (const key of [...memoryStore.keys()]) {
    if (key.startsWith(prefix)) memoryStore.delete(key)
  }
}

/**
 * Read-through cache: returns the cached value or produces, stores and returns it.
 * Cached `null` results count as hits (negative caching).
 *
 * Misses are single-flight per process: concurrent requests for a cold key share
 * one producer, and only that producer counts as a cache miss (database work).
 */
async function wrap<T>(key: string, ttlSeconds: number, producer: () => Promise<T>): Promise<T> {
  const namespace = namespaceOf(key)
  if (env.CACHE_DISABLED) {
    cacheMissesTotal.inc({ namespace })
    return producer()
  }

  const entry = await read(key)
  if (entry.hit) {
    cacheHitsTotal.inc({ namespace })
    return entry.value as T
  }

  const pending = inflight.get(key)
  if (pending) {
    cacheCoalescedTotal.inc({ namespace })
    return (await pending) as T
  }

  cacheMissesTotal.inc({ namespace })
  const run = producer()
    .then(async (value) => {
      await write(key, value, ttlSeconds)
      return value
    })
    .finally(() => {
      inflight.delete(key)
    })
  inflight.set(key, run)
  return run
}

export const cache = {
  get,
  set,
  del,
  delPrefix,
  wrap,
  backend: getCacheBackend,
}

export const cacheKeys = {
  workspaceAnalytics: (workspaceId: string, rangeDays: number) =>
    `ff:analytics:${workspaceId}:${rangeDays}`,
  workspaceDashboard: (workspaceId: string, userId: string) =>
    `ff:dashboard:${workspaceId}:${userId}`,
  workspaceUserMinis: (workspaceId: string) => `ff:usersmini:${workspaceId}`,
  membership: (workspaceId: string, userId: string) => `ff:membership:${workspaceId}:${userId}`,
  workspaceByRef: (ref: string) => `ff:wsref:${ref}`,
  userExists: (userId: string) => `ff:userexists:${userId}`,
  workspaceAnalyticsPrefix: (workspaceId: string) => `ff:analytics:${workspaceId}:`,
  workspaceDashboardPrefix: (workspaceId: string) => `ff:dashboard:${workspaceId}:`,
  workspaceUserMinisPrefix: (workspaceId: string) => `ff:usersmini:${workspaceId}`,
  workspacePrefix: (workspaceId: string) => `ff:analytics:${workspaceId}:`,
}
