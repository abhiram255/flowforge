import { getCacheBackend, getRedisClient } from '../config/redis'

interface MemoryEntry {
  value: string
  expiresAt: number
}

const memoryStore = new Map<string, MemoryEntry>()

async function get<T>(key: string): Promise<T | null> {
  const redis = getRedisClient()
  if (redis) {
    try {
      const raw = await redis.get(key)
      return raw ? (JSON.parse(raw) as T) : null
    } catch {
      return null
    }
  }
  const entry = memoryStore.get(key)
  if (!entry) return null
  if (entry.expiresAt < Date.now()) {
    memoryStore.delete(key)
    return null
  }
  return JSON.parse(entry.value) as T
}

async function set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const raw = JSON.stringify(value)
  const redis = getRedisClient()
  if (redis) {
    try {
      await redis.set(key, raw, 'EX', ttlSeconds)
    } catch {
      /* cache writes are best-effort */
    }
    return
  }
  memoryStore.set(key, { value: raw, expiresAt: Date.now() + ttlSeconds * 1000 })
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

/** Read-through cache: returns the cached value or produces, stores and returns it. */
async function wrap<T>(key: string, ttlSeconds: number, producer: () => Promise<T>): Promise<T> {
  const cached = await get<T>(key)
  if (cached !== null) return cached
  const value = await producer()
  await set(key, value, ttlSeconds)
  return value
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
  workspaceAnalytics: (workspaceId: string, rangeDays: number) => `ff:analytics:${workspaceId}:${rangeDays}`,
  workspaceDashboard: (workspaceId: string, userId: string) => `ff:dashboard:${workspaceId}:${userId}`,
  workspaceUserMinis: (workspaceId: string) => `ff:usersmini:${workspaceId}`,
  membership: (workspaceId: string, userId: string) => `ff:membership:${workspaceId}:${userId}`,
  workspaceAnalyticsPrefix: (workspaceId: string) => `ff:analytics:${workspaceId}:`,
  workspaceDashboardPrefix: (workspaceId: string) => `ff:dashboard:${workspaceId}:`,
  workspaceUserMinisPrefix: (workspaceId: string) => `ff:usersmini:${workspaceId}`,
  workspacePrefix: (workspaceId: string) => `ff:analytics:${workspaceId}:`,
}
