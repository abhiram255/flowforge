import type { RequestHandler } from 'express'
import type { Role } from '@flowforge/shared'
import { AppError } from '../lib/errors'
import { assertAtLeast } from '../lib/permissions'

/** Server-side RBAC — the only place write permissions are decided. */
export const requireRole =
  (min: Role): RequestHandler =>
  (req, _res, next) => {
    try {
      if (!req.ctx) throw AppError.internal('Workspace context missing')
      assertAtLeast(req.ctx.role, min)
      next()
    } catch (error) {
      next(error)
    }
  }
