import type { RegisterInput } from '@flowforge/shared'
import { ERROR_CODES } from '@flowforge/shared'
import { env } from '../../config/env'
import { AppError } from '../../lib/errors'
import { hashPassword, verifyPassword } from '../../lib/password'
import { toSessionDTO } from '../../lib/serialize'
import { generateRefreshToken, hashRefreshToken, newFamilyId, signAccessToken } from '../../lib/tokens'
import { Session, type SessionDoc } from '../../models/Session'
import { User, type UserDoc } from '../../models/User'

export interface RequestMeta {
  userAgent?: string | null
  ip?: string | null
}

export interface IssuedSession {
  user: UserDoc
  accessToken: string
  refreshToken: string
  refreshExpiresAt: Date
}

/**
 * Concurrent-refresh grace window. Two tabs can legitimately present the same
 * refresh token within milliseconds of each other; only reuse *outside* this
 * window is treated as token theft.
 */
const REUSE_GRACE_MS = 15_000

async function createSession(
  userId: UserDoc['_id'],
  familyId: string,
  meta: RequestMeta,
): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const { token, hash } = generateRefreshToken()
  const expiresAt = new Date(Date.now() + env.refreshTokenTtlMs)
  const doc = await Session.create({
    userId,
    familyId,
    refreshTokenHash: hash,
    userAgent: meta.userAgent?.slice(0, 512) ?? null,
    ip: meta.ip ?? null,
    expiresAt,
  })
  return { token, sessionId: String(doc._id), expiresAt }
}

let dummyHashPromise: Promise<string> | null = null
/** Equalises response timing so unknown emails cannot be probed. */
async function burnTime(password: string): Promise<void> {
  if (!dummyHashPromise) dummyHashPromise = hashPassword('flowforge-timing-equalizer')
  await verifyPassword(password, await dummyHashPromise).catch(() => undefined)
}

export async function registerUser(input: RegisterInput, meta: RequestMeta): Promise<IssuedSession> {
  const existing = await User.findOne({ email: input.email }).select('_id').lean()
  if (existing) {
    throw AppError.conflict('An account with this email already exists', ERROR_CODES.EMAIL_TAKEN)
  }

  const passwordHash = await hashPassword(input.password)
  const user = await User.create({ name: input.name, email: input.email, passwordHash })

  const session = await createSession(user._id, newFamilyId(), meta)
  const accessToken = signAccessToken(String(user._id), session.sessionId)
  return {
    user: user.toObject() as UserDoc,
    accessToken,
    refreshToken: session.token,
    refreshExpiresAt: session.expiresAt,
  }
}

export async function loginUser(
  email: string,
  password: string,
  meta: RequestMeta,
): Promise<IssuedSession> {
  const user = await User.findOne({ email }).select('+passwordHash')
  if (!user) {
    await burnTime(password)
    throw AppError.unauthorized(ERROR_CODES.INVALID_CREDENTIALS, 'Invalid email or password')
  }

  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) {
    throw AppError.unauthorized(ERROR_CODES.INVALID_CREDENTIALS, 'Invalid email or password')
  }

  const session = await createSession(user._id, newFamilyId(), meta)
  const accessToken = signAccessToken(String(user._id), session.sessionId)
  const plain = user.toObject() as UserDoc
  return {
    user: plain,
    accessToken,
    refreshToken: session.token,
    refreshExpiresAt: session.expiresAt,
  }
}

/**
 * Rotates a refresh token. The presented token is atomically claimed; a token
 * that was already rotated is treated as reuse and revokes its whole family.
 */
export async function rotateRefreshToken(rawToken: string, meta: RequestMeta): Promise<IssuedSession> {
  const hash = hashRefreshToken(rawToken)
  const now = new Date()

  const claimed = await Session.findOneAndUpdate(
    { refreshTokenHash: hash, revokedAt: null, expiresAt: { $gt: now } },
    { $set: { revokedAt: now, lastUsedAt: now } },
    { new: true },
  ).lean<SessionDoc>()

  if (!claimed) {
    const known = await Session.findOne({ refreshTokenHash: hash }).lean<SessionDoc>()
    if (known) {
      const revokedAgoMs = now.getTime() - (known.revokedAt?.getTime() ?? 0)
      if (revokedAgoMs < REUSE_GRACE_MS && known.replacedBy) {
        const successor = await Session.findById(known.replacedBy).lean<SessionDoc>()
        if (successor && !successor.revokedAt && successor.expiresAt > now) {
          // Legitimate concurrent refresh (e.g. two tabs) — issue a sibling token.
          const user = await User.findById(known.userId).lean<UserDoc>()
          if (user) {
            const session = await createSession(user._id, known.familyId, meta)
            return {
              user,
              accessToken: signAccessToken(String(user._id), session.sessionId),
              refreshToken: session.token,
              refreshExpiresAt: session.expiresAt,
            }
          }
        }
      }
      await Session.updateMany(
        { familyId: known.familyId, revokedAt: null },
        { $set: { revokedAt: now } },
      )
      throw AppError.unauthorized(
        ERROR_CODES.REFRESH_REUSE_DETECTED,
        'Refresh token reuse detected — all sessions in this family were revoked. Please sign in again.',
      )
    }
    throw AppError.unauthorized(ERROR_CODES.TOKEN_INVALID, 'Invalid refresh token')
  }

  const user = await User.findById(claimed.userId).lean<UserDoc>()
  if (!user) {
    throw AppError.unauthorized(ERROR_CODES.TOKEN_INVALID, 'Account no longer exists')
  }

  const session = await createSession(user._id, claimed.familyId, meta)
  await Session.updateOne({ _id: claimed._id }, { $set: { replacedBy: session.sessionId } })

  return {
    user,
    accessToken: signAccessToken(String(user._id), session.sessionId),
    refreshToken: session.token,
    refreshExpiresAt: session.expiresAt,
  }
}

export async function logoutSession(userId: string, sessionId: string): Promise<void> {
  await Session.updateOne(
    { _id: sessionId, userId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  )
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string): Promise<void> {
  await Session.updateMany(
    { userId, revokedAt: null, ...(exceptSessionId ? { _id: { $ne: exceptSessionId } } : {}) },
    { $set: { revokedAt: new Date() } },
  )
}

export async function listSessions(userId: string, currentSessionId: string) {
  const docs = await Session.find({ userId, revokedAt: null, expiresAt: { $gt: new Date() } })
    .sort({ createdAt: -1 })
    .lean<SessionDoc[]>()
  return docs.map((doc) => toSessionDTO(doc, currentSessionId))
}

export async function revokeSession(userId: string, sessionId: string): Promise<void> {
  const result = await Session.findOneAndUpdate(
    { _id: sessionId, userId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  )
  if (!result) throw AppError.notFound('Session not found')
}
