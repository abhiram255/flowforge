import compression from 'compression'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express, { type Express } from 'express'
import helmet from 'helmet'
import { APP_VERSION, env } from './config/env'
import { metricsHandler, metricsMiddleware } from './lib/metrics'
import { errorHandler, notFoundHandler } from './middleware/errors'
import { httpLogger, requestIdMiddleware } from './middleware/requestContext'
import { apiLimiter } from './middleware/rateLimit'
import { v1Router } from './routes'

export function createApp(): Express {
  const app = express()

  // One hop by default (Traefik/nginx in front); set TRUST_PROXY_HOPS=0 when the
  // API is exposed directly so X-Forwarded-For cannot be spoofed.
  app.set('trust proxy', env.TRUST_PROXY_HOPS)
  app.disable('x-powered-by')

  app.use(requestIdMiddleware)
  app.use(httpLogger)
  app.use(metricsMiddleware)
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))
  app.use(
    cors({
      origin: env.corsOrigins,
      credentials: true,
      exposedHeaders: ['x-request-id'],
    }),
  )
  // JSON compresses well at low effort; level 1 trades ~10% compression ratio
  // for a large reduction in per-request CPU (measurable under load).
  app.use(compression({ level: 1, threshold: 1024 }))
  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())

  app.get('/', (_req, res) => {
    res.json({ name: 'FlowForge API', version: APP_VERSION, health: '/api/v1/health' })
  })

  app.use('/api/v1', apiLimiter, v1Router)
  app.get('/metrics', metricsHandler)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
