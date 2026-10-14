import mongoose from 'mongoose'
import { env } from './env'
import { logger } from './logger'

export async function connectDatabase(uri: string = env.MONGODB_URI): Promise<void> {
  mongoose.set('strictQuery', true)
  mongoose.connection.on('error', (err) => logger.error({ err }, 'MongoDB connection error'))
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'))
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 })
  logger.info({ database: mongoose.connection.name, host: mongoose.connection.host }, 'MongoDB connected')
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect()
}

export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === 1
}
