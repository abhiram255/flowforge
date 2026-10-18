import os from 'node:os'
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

/**
 * The schema is exported as a builder so tests can validate hypothetical
 * environments (e.g. production rules) without touching `process.env`.
 */
export function buildEnvSchema() {
  return z
    .object({
      NODE_ENV: z.enum(['development', 'test', 'e2e', 'production']).default('development'),
      PORT: z.coerce.number().int().min(1).max(65535).default(4000),
      APP_URL: z.string().url().default('http://localhost:5173'),
      CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:8080'),

      /**
       * Which part of the system this process runs:
       *  - `all`    — HTTP API + background workers in one process (development default)
       *  - `api`    — HTTP API only; jobs go to Redis and are executed by the worker tier
       *  - `worker` — background workers + a minimal ops surface (health/metrics)
       */
      PROCESS_ROLE: z.enum(['all', 'api', 'worker']).default('all'),
      TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(1),

      /**
       * HTTP server timeouts. keepAliveTimeout should stay above any intermediary
       * idle timeout (Traefik/nginx/LBs) so connections are reused; headersTimeout
       * must exceed keepAliveTimeout (Node requirement).
       */
      HTTP_KEEPALIVE_TIMEOUT_MS: z.coerce.number().int().min(0).default(65_000),
      HTTP_HEADERS_TIMEOUT_MS: z.coerce.number().int().min(0).default(66_000),
      HTTP_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(0).default(30_000),
      /** How long graceful shutdown waits for in-flight requests before closing sockets. */
      DRAIN_TIMEOUT_MS: z.coerce.number().int().min(0).default(10_000),

      MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/flowforge_dev'),
      MONGODB_MAX_POOL_SIZE: z.coerce.number().int().min(1).default(100),
      MONGODB_MIN_POOL_SIZE: z.coerce.number().int().min(0).default(0),
      MONGODB_SOCKET_TIMEOUT_MS: z.coerce.number().int().min(0).default(45_000),
      /**
       * Read preference for analytics/dashboard aggregations only (auth, tenancy
       * and task reads always use the primary). `secondaryPreferred` offloads
       * read-heavy aggregation work to replica-set secondaries.
       */
      MONGODB_ANALYTICS_READ_PREFERENCE: z
        .enum(['primary', 'secondaryPreferred'])
        .default('primary'),
      /**
       * Automatic index builds on boot. True in dev/test; production runs with
       * `false` and builds indexes through the one-shot `ensure-indexes` script,
       * so a large collection never triggers a surprise index build at boot.
       */
      MONGODB_AUTO_INDEX: booleanish(true),

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

      /** General API budget per client per minute (shared across replicas via Redis). */
      API_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(600),
      /** Upper bound for the in-process cache fallback (never grows unbounded). */
      CACHE_MEMORY_MAX_ENTRIES: z.coerce.number().int().min(1).default(5_000),

      STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
      LOCAL_STORAGE_DIR: z.string().default('./storage'),
      /** Temp dir for streamed uploads (files are removed after the transfer). */
      UPLOAD_TMP_DIR: z.string().default(path.join(os.tmpdir(), 'flowforge-uploads')),
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
      /**
       * Explicit opt-in to seed the demo dataset into a NODE_ENV=production
       * stack (demo/staging only). The seed refuses production without it.
       */
      SEED_FORCE: booleanish(false),
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
        if (!value.REDIS_URL) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['REDIS_URL'],
            message:
              'Redis is required in production — shared cache, queues, rate limits and realtime across replicas depend on it',
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
      if (value.PROCESS_ROLE === 'worker' && !value.REDIS_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['REDIS_URL'],
          message:
            'PROCESS_ROLE=worker requires REDIS_URL — there is nothing to work on without a queue',
        })
      }
    })
}

const parsed = buildEnvSchema().safeParse(process.env)

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

const uploadTmpDir =
  data.UPLOAD_TMP_DIR.trim().length > 0
    ? data.UPLOAD_TMP_DIR
    : path.join(os.tmpdir(), 'flowforge-uploads')

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
  uploadTmpDirAbs: path.isAbsolute(uploadTmpDir)
    ? uploadTmpDir
    : path.resolve(apiRoot, uploadTmpDir),
  /** Tests rely on implicit index builds (text search); production turns them off. */
  mongoAutoIndex: isTest ? true : data.MONGODB_AUTO_INDEX,
  /** This process serves HTTP traffic. */
  runsHttp: data.PROCESS_ROLE !== 'worker',
  /** This process consumes background jobs from the queue. */
  runsWorkers: data.PROCESS_ROLE !== 'api',
  apiRoot,
} as const

export type Env = typeof env

export const APP_VERSION = '0.1.0'
