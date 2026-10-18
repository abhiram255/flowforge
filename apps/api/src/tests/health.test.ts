import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createOpsApp } from '../app'
import { app, connectTestDatabase, disconnectTestDatabase } from './helpers'

describe('health and readiness', () => {
  beforeAll(connectTestDatabase)
  afterAll(disconnectTestDatabase)

  it('reports liveness with the service backends', async () => {
    const response = await request(app).get('/api/v1/health')
    expect(response.status).toBe(200)
    expect(response.body.status).toBe('ok')
    expect(response.body.db).toBe('connected')
    // Test environment runs without Redis on purpose — the fallbacks are real.
    expect(response.body.cache).toBe('memory')
    expect(response.body.queues).toBe('inline')
  })

  it('reports readiness with per-dependency checks', async () => {
    const response = await request(app).get('/api/v1/health/ready')
    expect(response.status).toBe(200)
    expect(response.body.status).toBe('ready')
    expect(response.body.checks).toEqual({ db: 'up', redis: 'disabled' })
  })

  it('exposes only the ops surface on the worker app', async () => {
    const ops = createOpsApp()
    const ready = await request(ops).get('/api/v1/health/ready')
    expect(ready.status).toBe(200)

    const metrics = await request(ops).get('/metrics')
    expect(metrics.status).toBe(200)
    expect(metrics.text).toContain('flowforge_http_requests_total')

    const business = await request(ops).get('/api/v1/workspaces')
    expect(business.status).toBe(404)
  })
})
