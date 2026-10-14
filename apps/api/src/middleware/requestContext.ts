import { randomUUID } from 'node:crypto'
import { pinoHttp } from 'pino-http'
import type { RequestHandler } from 'express'
import { logger } from '../config/logger'

/** Attaches a correlation id to every request (honours an inbound x-request-id). */
export const requestIdMiddleware: RequestHandler = (req, res, next) => {
  const header = req.headers['x-request-id']
  const id = typeof header === 'string' && header.length > 0 ? header : randomUUID()
  req.id = id
  res.setHeader('x-request-id', id)
  next()
}

export const httpLogger = pinoHttp({
  logger,
  autoLogging: {
    ignore: (req) =>
      req.url?.startsWith('/api/v1/health') === true || req.url?.startsWith('/metrics') === true,
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error'
    if (res.statusCode >= 400) return 'warn'
    return 'debug'
  },
})
