import mongoose from 'mongoose'
import { env } from './env'
import { logger } from './logger'

// Belt and braces for index builds: the global switch also covers models that
// were compiled before this module was evaluated, and the connect option below
// covers index builds triggered when the connection opens.
mongoose.set('autoIndex', env.mongoAutoIndex)

export async function connectDatabase(uri: string = env.MONGODB_URI): Promise<void> {
  mongoose.set('strictQuery', true)
  mongoose.set('autoIndex', env.mongoAutoIndex)
  mongoose.connection.on('error', (err) => logger.error({ err }, 'MongoDB connection error'))
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'))
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: env.MONGODB_MAX_POOL_SIZE,
    minPoolSize: env.MONGODB_MIN_POOL_SIZE,
    socketTimeoutMS: env.MONGODB_SOCKET_TIMEOUT_MS,
    autoIndex: env.mongoAutoIndex,
    // Shows up in `db.currentOp()` / profiler output, one entry per replica.
    appName: `flowforge-${env.PROCESS_ROLE}`,
  })
  logger.info(
    {
      database: mongoose.connection.name,
      host: mongoose.connection.host,
      poolSize: env.MONGODB_MAX_POOL_SIZE,
      autoIndex: env.mongoAutoIndex,
    },
    'MongoDB connected',
  )
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect()
}

export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === 1
}
