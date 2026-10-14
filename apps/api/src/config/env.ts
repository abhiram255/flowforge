import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnvFile } from 'dotenv'
import { z } from 'zod'
import { parseDuration } from '../lib/utils'

const here = path.dirname(fileURLToPath(import.meta.url))
const apiRoot = path.resolve(here, '../..')
const repoRoot = path.resolve(apiRoot, '../..')

/** Load `.env.local` → `.env.<NODE_ENV>` → `.env` from both the api workspace and repo root. */
const targetEnv = process.env.NODE_ENV ?? 'development'
for (const file of ['.env.local', `.env.${targetEnv}`, '.env']) {
  loadEnvFile({ path: path.join(apiRoot, file) })
  loadEnvFile({ path: path.join(repoRoot, file) })
}

const DEV_JWT_SECRET = 'dev-only-access-secret-change-me-at-least-32-chars'

const booleanish = (defaultValue: boolean) =>
  z
    .preprocess((value) => {
      if (typeof value === 'string') return ['true', '1', 'yes', 'on'].includes(value.toLowerCase())
      return value
    }, z.boolean())
    .default(defaultValue)

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'e2e', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    APP_URL: z.string().url().default('http://localhost:5173'),
    CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:8080'),

    MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/flowforge_dev'),

    JWT_ACCESS_SECRET: z
      .string()
      .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters')
      .default(DEV_JWT_SECRET),
    ACCESS_TOKEN_TTL: z.string().default('15m'),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    COOKIE_SECURE: booleanish(false),

    REDIS_URL: z.string().optional(),

    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    LOCAL_STORAGE_DIR: z.string().default('./storage'),
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: booleanish(true),

    SMTP_URL: z.string().optional(),
    MAIL_FROM: z.string().default('FlowForge <no-reply@flowforge.local>'),

    MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(100).default(10),

    SEED_ON_START: booleanish(false),
    SEED_RESET: booleanish(false),
    /** Benchmark-only escape hatch — refused in production. */
    RATE_LIMIT_DISABLED: booleanish(false),
    /** Cache A/B comparison for benchmarks — refused in production. */
    CACHE_DISABLED: booleanish(false),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === 'production') {
      if (value.SEED_ON_START || value.SEED_RESET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SEED_ON_START'],
          message: 'Seeding is refused in production',
        })
      }
      if (value.RATE_LIMIT_DISABLED) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['RATE_LIMIT_DISABLED'],
          message: 'Rate limiting cannot be disabled in production',
        })
      }
      if (value.CACHE_DISABLED) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CACHE_DISABLED'],
          message: 'The cache cannot be disabled in production',
        })
      }
      if (value.JWT_ACCESS_SECRET === DEV_JWT_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_ACCESS_SECRET'],
          message: 'Replace the development JWT secret in production',
        })
      }
      if (!value.COOKIE_SECURE) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['COOKIE_SECURE'],
          message: 'COOKIE_SECURE must be true in production (HTTPS-only refresh cookies)',
        })
      }
      if (
        value.STORAGE_DRIVER === 's3' &&
        (!value.S3_BUCKET || !value.S3_ACCESS_KEY_ID || !value.S3_SECRET_ACCESS_KEY)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['STORAGE_DRIVER'],
          message: 'S3 storage requires S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY',
        })
      }
    }
  })

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n')
  // eslint-disable-next-line no-console
  console.error(`Invalid environment configuration:\n${details}`)
  process.exit(1)
}

const data = parsed.data
const nodeEnv = data.NODE_ENV
const isProduction = nodeEnv === 'production'
const isTest = nodeEnv === 'test' || nodeEnv === 'e2e'

export const env = {
  ...data,
  isProduction,
  isTest,
  corsOrigins: data.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  accessTokenTtlSeconds: parseDuration(data.ACCESS_TOKEN_TTL),
  refreshTokenTtlMs: data.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  maxUploadBytes: data.MAX_UPLOAD_MB * 1024 * 1024,
  localStorageDirAbs: path.isAbsolute(data.LOCAL_STORAGE_DIR)
    ? data.LOCAL_STORAGE_DIR
    : path.resolve(apiRoot, data.LOCAL_STORAGE_DIR),
  apiRoot,
} as const

export type Env = typeof env

export const APP_VERSION = '0.1.0'
