import { Types } from 'mongoose'
import { ERROR_CODES, MAX_PAGE_SIZE } from '@flowforge/shared'
import { AppError } from './errors'

export interface Cursor {
  t: Date
  id: Types.ObjectId
}

export interface Page<T> {
  data: T[]
  nextCursor: string | null
  hasMore: boolean
}

/**
 * Cursor pagination is `(createdAt, _id)` compound and opaque (base64url), so
 * large feeds page through indexed ranges instead of `skip` scans.
 */
export function encodeCursor(doc: { createdAt: Date; _id: Types.ObjectId | string }): string {
  const payload = JSON.stringify({ t: new Date(doc.createdAt).toISOString(), i: String(doc._id) })
  return Buffer.from(payload, 'utf8').toString('base64url')
}

export function parseCursor(cursor?: string | null): Cursor | null {
  if (!cursor) return null
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      t?: string
      i?: string
    }
    if (!decoded.t || !decoded.i) throw new Error('incomplete cursor')
    const t = new Date(decoded.t)
    if (Number.isNaN(t.getTime()) || !Types.ObjectId.isValid(decoded.i)) throw new Error('bad cursor')
    return { t, id: new Types.ObjectId(decoded.i) }
  } catch {
    throw new AppError(400, ERROR_CODES.INVALID_CURSOR, 'Invalid pagination cursor')
  }
}

export function cursorFilter(cursor: Cursor | null, field = 'createdAt'): Record<string, unknown> {
  if (!cursor) return {}
  return {
    $or: [{ [field]: { $lt: cursor.t } }, { [field]: cursor.t, _id: { $lt: cursor.id } }],
  }
}

/** Expects `limit + 1` documents fetched; produces a page with a next cursor. */
export function finalizePage<T extends { createdAt: Date; _id: Types.ObjectId | string }>(
  docs: T[],
  limit: number,
): Page<T> {
  const hasMore = docs.length > limit
  const data = hasMore ? docs.slice(0, limit) : docs
  const last = data[data.length - 1]
  return {
    data,
    hasMore,
    nextCursor: hasMore && last ? encodeCursor(last) : null,
  }
}

export function clampLimit(limit: number | undefined, fallback = 25): number {
  return Math.min(Math.max(limit ?? fallback, 1), MAX_PAGE_SIZE)
}
