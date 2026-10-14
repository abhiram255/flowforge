import rateLimit, { type ClientRateLimitInfo, type Options, type Store } from 'express-rate-limit'
import { ERROR_CODES } from '@flowforge/shared'
import { env } from '../config/env'
import { getRedisClient } from '../config/redis'

const handler = (
  _req: unknown,
  res: { status: (code: number) => { json: (body: unknown) => void } },
) => {
  res.status(429).json({
    error: { code: ERROR_CODES.RATE_LIMITED, message: 'Too many requests — please slow down.' },
  })
}

const base = {
  standardHeaders: 'draft-7' as const,
  legacyHeaders: false,
  handler,
  skip: () => env.isTest || env.RATE_LIMIT_DISABLED,
}

/**
 * Rate-limit counter store.
 *
 * With Redis the counters live there, so every API instance shares one budget —
 * without it, N replicas would multiply every limit by N. When Redis is absent
 * (local development, tests) it degrades to per-process counters, which is
 * correct for a single instance.
 */
class SharedStore implements Store {
  private readonly memory = new Map<string, { totalHits: number; resetTime: Date }>()
  private windowMs = 60_000

  constructor(private readonly redisPrefix: string) {}

  init(options: Options): void {
    this.windowMs = options.windowMs
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const redis = getRedisClient()
    if (redis) {
      try {
        const redisKey = `${this.redisPrefix}${key}`
        const totalHits = await redis.incr(redisKey)
        if (totalHits === 1) await redis.pexpire(redisKey, this.windowMs)
        const ttl = await redis.pttl(redisKey)
        return { totalHits, resetTime: new Date(Date.now() + Math.max(ttl, 0)) }
      } catch {
        /* fall through to the in-process counter */
      }
    }
    const now = Date.now()
    const existing = this.memory.get(key)
    const entry =
      existing && existing.resetTime.getTime() > now
        ? existing
        : { totalHits: 0, resetTime: new Date(now + this.windowMs) }
    entry.totalHits += 1
    this.memory.set(key, entry)
    return { totalHits: entry.totalHits, resetTime: entry.resetTime }
  }

  async decrement(key: string): Promise<void> {
    const redis = getRedisClient()
    if (redis) {
      try {
        await redis.decr(`${this.redisPrefix}${key}`)
        return
      } catch {
        /* fall through */
      }
    }
    const entry = this.memory.get(key)
    if (entry) entry.totalHits = Math.max(entry.totalHits - 1, 0)
  }

  async resetKey(key: string): Promise<void> {
    const redis = getRedisClient()
    if (redis) {
      try {
        await redis.del(`${this.redisPrefix}${key}`)
        return
      } catch {
        /* fall through */
      }
    }
    this.memory.delete(key)
  }
}

/** General API budget. */
export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 600,
  store: new SharedStore('ff:rl:api:'),
  ...base,
})

/** Stricter budget for credential endpoints (brute-force protection). */
export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  store: new SharedStore('ff:rl:auth:'),
  ...base,
})

/** Uploads are heavier; cap the frequency per client. */
export const uploadLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  store: new SharedStore('ff:rl:upload:'),
  ...base,
})
