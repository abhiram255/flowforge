import IORedis from 'ioredis'
import { env } from './env'
import { logger } from './logger'

export type CacheBackend = 'redis' | 'memory'

let client: IORedis | null = null
let backend: CacheBackend = 'memory'

export function getRedisClient(): IORedis | null {
  return client
}

export function getCacheBackend(): CacheBackend {
  return backend
}

export function isRedisEnabled(): boolean {
  return backend === 'redis'
}

/**
 * Connect to Redis when configured. When Redis is absent or unreachable the
 * application degrades gracefully: in-process cache + inline job processing.
 */
export async function initRedis(): Promise<CacheBackend> {
  if (!env.REDIS_URL) {
    logger.info('REDIS_URL not set — using in-process cache and inline job processing')
    return backend
  }

  const candidate = new IORedis(env.REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: null,
    retryStrategy: (times) => (times > 3 ? null : Math.min(times * 250, 2000)),
  })
  candidate.on('error', (err: Error) => {
    if (backend === 'redis') logger.warn({ err: err.message }, 'Redis error')
  })

  try {
    await candidate.connect()
    await candidate.ping()
    client = candidate
    backend = 'redis'
    logger.info('Redis connected — shared cache and BullMQ queues enabled')
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Redis unavailable — falling back to in-process cache and inline jobs')
    candidate.disconnect()
  }
  return backend
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit().catch(() => undefined)
    client = null
    backend = 'memory'
  }
}
