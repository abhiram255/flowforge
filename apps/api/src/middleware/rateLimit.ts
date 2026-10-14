import rateLimit from 'express-rate-limit'
import { ERROR_CODES } from '@flowforge/shared'
import { env } from '../config/env'

const handler = (_req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }) => {
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

/** General API budget. */
export const apiLimiter = rateLimit({ windowMs: 60_000, limit: 600, ...base })

/** Stricter budget for credential endpoints (brute-force protection). */
export const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, ...base })

/** Uploads are heavier; cap the frequency per client. */
export const uploadLimiter = rateLimit({ windowMs: 60_000, limit: 60, ...base })
