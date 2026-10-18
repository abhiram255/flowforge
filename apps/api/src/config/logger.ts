import { createRequire } from 'node:module'
import { pino, type Logger } from 'pino'
import { env } from './env'

const require = createRequire(import.meta.url)

const REDACT = {
  paths: [
    'req.headers.authorization',
    'req.headers.cookie',
    'password',
    'passwordHash',
    'token',
    'refreshToken',
    'accessToken',
  ],
  censor: '[redacted]',
}

/**
 * Pretty logs are a development nicety, not a runtime dependency: the
 * production image ships without devDependencies, so a NODE_ENV=development
 * process there (benchmark overlays, operators debugging) must fall back to
 * JSON instead of crashing at import time.
 */
function hasPinoPretty(): boolean {
  try {
    require.resolve('pino-pretty')
    return true
  } catch {
    return false
  }
}

function createLogger(): Logger {
  const options = {
    level: env.LOG_LEVEL,
    base: { service: 'flowforge-api' },
    redact: REDACT,
  }
  if (env.NODE_ENV === 'development' && hasPinoPretty()) {
    return pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' },
      },
    })
  }
  return pino(options)
}

export const logger = createLogger()
