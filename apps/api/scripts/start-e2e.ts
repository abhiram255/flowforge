export {}

/**
 * Boots the API for Playwright E2E runs: e2e database, deterministic seed,
 * development-safe secrets. Playwright's `webServer` invokes this with
 * `npm run dev:e2e -w @flowforge/api`.
 */
process.env.NODE_ENV = 'e2e'
process.env.PORT = process.env.PORT ?? '4000'
process.env.MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/flowforge_e2e'
process.env.SEED_ON_START = 'true'
process.env.SEED_RESET = 'true'
process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET ?? 'e2e-only-secret-e2e-only-secret-1234567890'
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'info'
process.env.REDIS_URL = process.env.REDIS_URL ?? ''

await import('../src/index.js')
