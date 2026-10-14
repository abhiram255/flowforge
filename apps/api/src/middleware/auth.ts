import type { RequestHandler } from 'express'
import { ERROR_CODES } from '@flowforge/shared'
import { AppError } from '../lib/errors'
import { asyncHandler } from '../lib/asyncHandler'
import { cache, cacheKeys } from '../lib/cache'
import { verifyAccessToken } from '../lib/tokens'
import { User } from '../models/User'

export const requireAuth: RequestHandler = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    throw AppError.unauthorized(ERROR_CODES.AUTH_REQUIRED, 'Missing access token')
  }
  const token = header.slice('Bearer '.length).trim()
  const payload = verifyAccessToken(token)

  // Account existence is stable; caching it removes one database round trip
  // from every authenticated request. A deleted account stops working within
  // the TTL (30s) rather than instantly — same bounded-staleness trade-off as
  // the 15-minute access-token window documented in DECISIONS.md.
  const exists = await cache.wrap<boolean>(cacheKeys.userExists(payload.sub), 30, async () => {
    const user = await User.findById(payload.sub).select('_id').lean()
    return Boolean(user)
  })
  if (!exists) {
    throw AppError.unauthorized(ERROR_CODES.TOKEN_INVALID, 'Account no longer exists')
  }

  req.auth = { userId: payload.sub, sessionId: payload.sid }
  next()
})
