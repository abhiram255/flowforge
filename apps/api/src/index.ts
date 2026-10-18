import { createServer } from 'node:http'
import { createApp, createOpsApp } from './app'
import { connectDatabase, disconnectDatabase } from './config/db'
import { APP_VERSION, env } from './config/env'
import { logger } from './config/logger'
import { closeRedis, initRedis } from './config/redis'
import { closeQueues, initQueues, startWorkers } from './jobs/queue'
import { closeRealtime, initRealtime } from './realtime/io'

async function main(): Promise<void> {
  logger.info(
    { version: APP_VERSION, nodeEnv: env.NODE_ENV, role: env.PROCESS_ROLE },
    'starting FlowForge API',
  )

  await connectDatabase()
  await initRedis()
  // API replicas keep the queue handle even though they never consume jobs:
  // without it `enqueue()` would fall back to running jobs inline in the
  // request path instead of publishing them to the worker tier.
  initQueues()
  if (env.runsWorkers) startWorkers()

  if (env.SEED_ON_START) {
    if (env.isProduction) {
      throw new Error('SEED_ON_START is refused in production')
    }
    const { seedDatabase } = await import('./scripts/seed.js')
    await seedDatabase({ reset: env.SEED_RESET })
  }

  // The worker role serves only the ops surface (health, readiness, metrics);
  // API replicas serve the full application.
  const app = env.runsHttp ? createApp() : createOpsApp()
  const server = createServer(app)
  // Keep-alive is deliberately longer than typical intermediary idle timeouts
  // (Traefik/nginx) so load balancers pay for connection setup once, not per
  // request, while an idle/abandoned connection cannot pin a socket forever.
  // requestTimeout bounds only how long a client may take to *send* a request —
  // it does not cap response time, and websocket upgrades plus streamed
  // downloads leave the HTTP parser, so neither is cut off by it.
  server.keepAliveTimeout = env.HTTP_KEEPALIVE_TIMEOUT_MS
  server.headersTimeout = env.HTTP_HEADERS_TIMEOUT_MS
  server.requestTimeout = env.HTTP_REQUEST_TIMEOUT_MS
  if (env.runsHttp) await initRealtime(server)

  await new Promise<void>((resolve) => {
    server.listen(env.PORT, () => resolve())
  })
  logger.info({ port: env.PORT }, `FlowForge API listening on http://localhost:${env.PORT}`)

  let shuttingDown = false
  const DRAIN_TIMEOUT_MS = env.DRAIN_TIMEOUT_MS
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info({ signal }, 'shutting down gracefully — draining in-flight requests')
    // 1. Disconnect realtime clients first: their long-lived sockets would
    //    otherwise hold the HTTP drain open until the timeout. Socket.IO also
    //    stops the listener, so no new connections are accepted from here on.
    await closeRealtime()
    // 2. Let in-flight HTTP requests finish (bounded by the drain timeout)
    //    before tearing down shared resources. This is what makes a rolling
    //    restart invisible to clients behind a load balancer.
    await new Promise<void>((resolve) => {
      if (!server.listening) {
        server.closeAllConnections?.()
        resolve()
        return
      }
      const timer = setTimeout(() => {
        logger.warn('drain timeout reached — closing remaining connections')
        server.closeAllConnections?.()
        resolve()
      }, DRAIN_TIMEOUT_MS)
      server.close(() => {
        clearTimeout(timer)
        resolve()
      })
      server.closeIdleConnections?.()
    })
    await closeQueues()
    await closeRedis()
    await disconnectDatabase()
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  // Windows console signal (Ctrl+Break is the only catchable one there).
  process.on('SIGBREAK', () => void shutdown('SIGBREAK'))
  // Dev/test tooling can trigger the same graceful path over the IPC channel when
  // this process was spawned as a child (the scalability experiments do).
  // Never active in production; Linux deployments use SIGTERM above.
  if (!env.isProduction && process.send) {
    process.on('message', (message) => {
      if (message === 'shutdown') void shutdown('ipc')
    })
  }
}

main().catch((error) => {
  logger.error({ err: error }, 'failed to start FlowForge API')
  process.exit(1)
})
