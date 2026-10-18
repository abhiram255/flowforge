import { describe, expect, it } from 'vitest'
import { buildEnvSchema } from '../config/env'

const parse = (values: Record<string, string | undefined>) => buildEnvSchema().safeParse(values)

const issuePaths = (values: Record<string, string | undefined>): string[] => {
  const result = parse(values)
  if (result.success) return []
  return result.error.issues.map((issue) => issue.path.join('.'))
}

const PRODUCTION_BASE = {
  NODE_ENV: 'production',
  REDIS_URL: 'redis://redis:6379',
  COOKIE_SECURE: 'true',
  JWT_ACCESS_SECRET: 'a-production-grade-secret-with-48-characters-ok',
}

describe('environment validation', () => {
  it('fills development defaults when nothing is set', () => {
    const result = parse({})
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.PROCESS_ROLE).toBe('all')
    expect(result.data.MONGODB_AUTO_INDEX).toBe(true)
    expect(result.data.MONGODB_ANALYTICS_READ_PREFERENCE).toBe('primary')
    expect(result.data.API_RATE_LIMIT_PER_MIN).toBe(600)
    expect(result.data.CACHE_MEMORY_MAX_ENTRIES).toBe(5000)
    expect(result.data.HTTP_HEADERS_TIMEOUT_MS).toBeGreaterThan(result.data.HTTP_KEEPALIVE_TIMEOUT_MS)
  })

  it('accepts a complete production environment', () => {
    expect(parse(PRODUCTION_BASE).success).toBe(true)
  })

  it('refuses production without Redis (shared state is required across replicas)', () => {
    const { REDIS_URL: _omitted, ...withoutRedis } = PRODUCTION_BASE
    expect(issuePaths(withoutRedis)).toContain('REDIS_URL')
  })

  it('refuses the development JWT secret in production', () => {
    const issues = issuePaths({
      ...PRODUCTION_BASE,
      JWT_ACCESS_SECRET: 'dev-only-access-secret-change-me-at-least-32-chars',
    })
    expect(issues).toContain('JWT_ACCESS_SECRET')
  })

  it('keeps the benchmark escape hatches refused in production', () => {
    expect(issuePaths({ ...PRODUCTION_BASE, RATE_LIMIT_DISABLED: 'true' })).toContain(
      'RATE_LIMIT_DISABLED',
    )
    expect(issuePaths({ ...PRODUCTION_BASE, CACHE_DISABLED: 'true' })).toContain('CACHE_DISABLED')
  })

  it('refuses PROCESS_ROLE=worker without Redis', () => {
    expect(issuePaths({ PROCESS_ROLE: 'worker' })).toContain('REDIS_URL')
    expect(parse({ PROCESS_ROLE: 'worker', REDIS_URL: 'redis://127.0.0.1:6379' }).success).toBe(true)
  })

  it('refuses unknown process roles', () => {
    expect(issuePaths({ PROCESS_ROLE: 'frontend' })).toContain('PROCESS_ROLE')
  })
})
