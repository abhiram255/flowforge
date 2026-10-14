import { createHash, randomBytes, randomUUID } from 'node:crypto'
import jwt, { type SignOptions } from 'jsonwebtoken'
import { ERROR_CODES } from '@flowforge/shared'
import { env } from '../config/env'
import { AppError } from './errors'

export interface AccessTokenPayload {
  sub: string
  sid: string
}

const ISSUER = 'flowforge'

export function signAccessToken(userId: string, sessionId: string): string {
  const options: SignOptions = {
    expiresIn: env.ACCESS_TOKEN_TTL as SignOptions['expiresIn'],
    issuer: ISSUER,
  }
  return jwt.sign({ sub: userId, sid: sessionId }, env.JWT_ACCESS_SECRET, options)
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: ISSUER }) as jwt.JwtPayload
    if (!payload.sub || typeof payload.sid !== 'string') throw new Error('malformed token')
    return { sub: payload.sub, sid: payload.sid }
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw AppError.unauthorized(ERROR_CODES.TOKEN_EXPIRED, 'Access token expired')
    }
    throw AppError.unauthorized(ERROR_CODES.TOKEN_INVALID, 'Invalid access token')
  }
}

/** Refresh tokens are opaque random strings — only their SHA-256 hash is stored. */
export function generateRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(48).toString('base64url')
  return { token, hash: hashRefreshToken(token) }
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

export function hashRefreshToken(token: string): string {
  return sha256Hex(token)
}

export function newFamilyId(): string {
  return randomUUID()
}
