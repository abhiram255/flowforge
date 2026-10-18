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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('redis health check timed out')), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error as Error)
      },
    )
  })
}

/**
 * Readiness probe for the shared Redis connection:
 *  - `disabled` when REDIS_URL is not configured (single-instance dev fallback)
 *  - `down` when Redis was configured but no live client exists (or it fails to answer)
 */
export async function checkRedisHealth(timeoutMs = 1500): Promise<'up' | 'down' | 'disabled'> {
  if (!env.REDIS_URL) return 'disabled'
  if (!client) return 'down'
  try {
    const pong = await withTimeout(client.ping(), timeoutMs)
    return pong === 'PONG' ? 'up' : 'down'
  } catch {
    return 'down'
  }
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
