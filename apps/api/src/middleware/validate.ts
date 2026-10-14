import type { RequestHandler } from 'express'
import type { ZodTypeAny } from 'zod'

export interface ValidationSchemas {
  body?: ZodTypeAny
  query?: ZodTypeAny
  params?: ZodTypeAny
}

/**
 * Parses and replaces request segments with validated (and defaulted) data.
 * Route handlers can then trust `req.body` / `req.query` completely.
 */
export const validate =
  (schemas: ValidationSchemas): RequestHandler =>
  (req, _res, next) => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params) as typeof req.params
      if (schemas.query) req.query = schemas.query.parse(req.query) as typeof req.query
      if (schemas.body) req.body = schemas.body.parse(req.body)
      next()
    } catch (error) {
      next(error)
    }
  }
