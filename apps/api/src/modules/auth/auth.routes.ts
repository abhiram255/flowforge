import { Router, type Request, type Response } from 'express'
import { loginSchema, refreshSchema, registerSchema } from '@flowforge/shared'
import { ERROR_CODES } from '@flowforge/shared'
import { env } from '../../config/env'
import { AppError } from '../../lib/errors'
import { asyncHandler } from '../../lib/asyncHandler'
import { toUserDTO } from '../../lib/serialize'
import { requireAuth } from '../../middleware/auth'
import { authLimiter } from '../../middleware/rateLimit'
import { validate } from '../../middleware/validate'
import {
  listSessions,
  loginUser,
  logoutSession,
  registerUser,
  revokeAllSessions,
  revokeSession,
  rotateRefreshToken,
  type RequestMeta,
} from './auth.service'

export const authRoutes = Router()

const REFRESH_COOKIE = 'ff_rt'
/** The cookie is scoped as tightly as possible: only auth endpoints ever receive it. */
const COOKIE_PATH = '/api/v1/auth'

function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax' as const,
    path: COOKIE_PATH,
  }
}

function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE, token, { ...cookieOptions(), expires: expiresAt })
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, cookieOptions())
}

function requestMeta(req: Request): RequestMeta {
  return { userAgent: req.get('user-agent') ?? null, ip: req.ip ?? null }
}

authRoutes.post(
  '/register',
  authLimiter,
  validate({ body: registerSchema }),
  asyncHandler(async (req, res) => {
    const result = await registerUser(req.body, requestMeta(req))
    setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt)
    res.status(201).json({ user: toUserDTO(result.user), accessToken: result.accessToken })
  }),
)

authRoutes.post(
  '/login',
  authLimiter,
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const result = await loginUser(req.body.email, req.body.password, requestMeta(req))
    setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt)
    res.json({ user: toUserDTO(result.user), accessToken: result.accessToken })
  }),
)

authRoutes.post(
  '/refresh',
  authLimiter,
  validate({ body: refreshSchema }),
  asyncHandler(async (req, res) => {
    const cookieToken = (req.cookies?.[REFRESH_COOKIE] as string | undefined) ?? undefined
    const rawToken = cookieToken ?? (req.body?.refreshToken as string | undefined)
    if (!rawToken) {
      throw AppError.unauthorized(ERROR_CODES.TOKEN_INVALID, 'Missing refresh token')
    }
    const result = await rotateRefreshToken(rawToken, requestMeta(req))
    setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt)
    res.json({ user: toUserDTO(result.user), accessToken: result.accessToken })
  }),
)

authRoutes.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    await logoutSession(req.auth!.userId, req.auth!.sessionId)
    clearRefreshCookie(res)
    res.status(204).end()
  }),
)

authRoutes.post(
  '/logout-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    await revokeAllSessions(req.auth!.userId)
    clearRefreshCookie(res)
    res.status(204).end()
  }),
)

authRoutes.get(
  '/sessions',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ data: await listSessions(req.auth!.userId, req.auth!.sessionId) })
  }),
)

authRoutes.delete(
  '/sessions/:sessionId',
  requireAuth,
  asyncHandler(async (req, res) => {
    await revokeSession(req.auth!.userId, req.params.sessionId as string)
    res.status(204).end()
  }),
)

authRoutes.delete(
  '/sessions',
  requireAuth,
  asyncHandler(async (req, res) => {
    await revokeAllSessions(req.auth!.userId, req.auth!.sessionId)
    res.json({ ok: true })
  }),
)
