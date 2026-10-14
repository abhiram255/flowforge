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
  initRealtime(server)

  await new Promise<void>((resolve) => {
    server.listen(env.PORT, () => resolve())
  })
  logger.info({ port: env.PORT }, `FlowForge API listening on http://localhost:${env.PORT}`)

  let shuttingDown = false
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info({ signal }, 'shutting down gracefully')
    server.close()
    await closeRealtime()
    await closeQueues()
    await closeRedis()
    await disconnectDatabase()
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch((error) => {
  logger.error({ err: error }, 'failed to start FlowForge API')
  process.exit(1)
})
