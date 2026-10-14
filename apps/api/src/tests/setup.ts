/**
 * Test environment. Runs before any application module is imported, so the
 * environment validation in `src/config/env.ts` sees test-safe values.
 */
process.env.NODE_ENV = 'test'
process.env.MONGODB_URI = process.env.MONGODB_URI_TEST ?? 'mongodb://127.0.0.1:27017/flowforge_test'
process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET ?? 'test-only-secret-test-only-secret-1234567890'
process.env.LOG_LEVEL = 'silent'
process.env.STORAGE_DRIVER = 'local'
process.env.LOCAL_STORAGE_DIR = './.test-storage'
process.env.COOKIE_SECURE = 'false'
process.env.ACCESS_TOKEN_TTL = '15m'
// Empty string disables Redis explicitly (dotenv will not override it).
process.env.REDIS_URL = ''
