import { createServer } from 'node:http'
import { createApp } from './app'
import { connectDatabase, disconnectDatabase } from './config/db'
import { APP_VERSION, env } from './config/env'
import { logger } from './config/logger'
import { closeRedis, initRedis } from './config/redis'
import { closeQueues, initQueues, startWorkers } from './jobs/queue'
import { closeRealtime, initRealtime } from './realtime/io'

async function main(): Promise<void> {
  logger.info({ version: APP_VERSION, nodeEnv: env.NODE_ENV }, 'starting FlowForge API')

  await connectDatabase()
  await initRedis()
  initQueues()
  startWorkers()

  if (env.SEED_ON_START) {
    if (env.isProduction) {
      throw new Error('SEED_ON_START is refused in production')
    }
    const { seedDatabase } = await import('../scripts/seed.js')
    await seedDatabase({ reset: env.SEED_RESET })
  }

  const app = createApp()
  const server = createServer(app)
  await initRealtime(server)

  await new Promise<void>((resolve) => {
    server.listen(env.PORT, () => resolve())
  })
  logger.info({ port: env.PORT }, `FlowForge API listening on http://localhost:${env.PORT}`)

  let shuttingDown = false
  const DRAIN_TIMEOUT_MS = 10_000
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
