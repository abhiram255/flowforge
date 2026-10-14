import type { RequestHandler } from 'express'
import { ERROR_CODES } from '@flowforge/shared'
import { AppError } from '../lib/errors'
import { asyncHandler } from '../lib/asyncHandler'
import { verifyAccessToken } from '../lib/tokens'
import { User } from '../models/User'

export const requireAuth: RequestHandler = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    throw AppError.unauthorized(ERROR_CODES.AUTH_REQUIRED, 'Missing access token')
  }
  const token = header.slice('Bearer '.length).trim()
  const payload = verifyAccessToken(token)

  const user = await User.findById(payload.sub).select('_id').lean()
  if (!user) {
    throw AppError.unauthorized(ERROR_CODES.TOKEN_INVALID, 'Account no longer exists')
  }

  req.auth = { userId: String(user._id), sessionId: payload.sid }
  next()
})
