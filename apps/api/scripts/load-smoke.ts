/**
 * HTTP load smoke test with autocannon against the real API + real MongoDB.
 *
 * This produces honest, reproducible latency numbers on local hardware for the
 * hot read paths (board list, task detail, cached dashboard). It is a smoke
 * test, not a capacity claim — see docs/BENCHMARKS.md for methodology notes.
 *
 * Usage: npm run load
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { createApp } from '../src/app'
import { connectDatabase, disconnectDatabase } from '../src/config/db'
import mongoose from 'mongoose'
import { env } from '../src/config/env'
import { logger } from '../src/config/logger'
import { DEMO_PASSWORD, seedDatabase } from './seed'

interface AutocannonResult {
  latency: { p50: number; p97_5: number; p99: number; average: number }
  requests: { average: number; total: number }
  errors: number
  non2xx: number
  timeouts: number
  duration: number
}

interface ScenarioResult {
  name: string
  url: string
  method: 'GET' | 'POST'
  connections: number
  durationSeconds: number
  requestsPerSecond: number
  latencyMs: { average: number; p50: number; p97_5: number; p99: number }
  totalRequests: number
  non2xx: number
  errors: number
  timeouts: number
}

async function runLoad(
  url: string,
  token: string,
  connections: number,
  durationSeconds: number,
  method: 'GET' | 'POST',
  body?: string,
): Promise<AutocannonResult> {
  const autocannon = (await import('autocannon')).default as unknown as (
    options: Record<string, unknown>,
  ) => Promise<AutocannonResult>
  return autocannon({
    url,
    method,
    connections,
    duration: durationSeconds,
    pipelining: 1,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body } : {}),
  })
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI_LOAD ?? 'mongodb://127.0.0.1:27017/flowforge_load'
  await connectDatabase(uri)
  logger.info('load: seeding dataset (scale=4)')
  await seedDatabase({ reset: true, scale: 4 })

  const app = createApp()
  const server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, () => resolve()))
  const port = (server.address() as AddressInfo).port
  const base = `http://localhost:${port}/api/v1`

  const login = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'aarav.mehta@flowforge.dev', password: DEMO_PASSWORD }),
  })
  if (!login.ok) throw new Error(`login failed: ${login.status}`)
  const { accessToken } = (await login.json()) as { accessToken: string }
  const headers = { authorization: `Bearer ${accessToken}` }

  const workspaces = (await (await fetch(`${base}/workspaces`, { headers })).json()) as {
    data: Array<{ id: string }>
  }
  const workspaceId = workspaces.data[0]!.id
  const projects = (await (
    await fetch(`${base}/workspaces/${workspaceId}/projects`, { headers })
  ).json()) as { data: Array<{ id: string }> }
  const projectId = projects.data[0]!.id
  const tasks = (await (
    await fetch(`${base}/projects/${projectId}/tasks?sort=position`, { headers })
  ).json()) as { data: Array<{ id: string }> }
  const taskId = tasks.data[0]!.id

  const scenarios = [
    {
      name: 'board task list @ 10 conns (service time signal)',
      url: `${base}/projects/${projectId}/tasks?sort=position`,
      connections: 10,
      durationSeconds: 10,
      method: 'GET' as const,
    },
    {
      name: 'board task list @ 50 conns',
      url: `${base}/projects/${projectId}/tasks?sort=position`,
      connections: 50,
      durationSeconds: 10,
      method: 'GET' as const,
    },
    {
      name: 'board task list @ 100 conns (saturation view)',
      url: `${base}/projects/${projectId}/tasks?sort=position`,
      connections: 100,
      durationSeconds: 10,
      method: 'GET' as const,
    },
    {
      name: 'task detail @ 50 conns (with count aggregations)',
      url: `${base}/tasks/${taskId}`,
      connections: 50,
      durationSeconds: 10,
      method: 'GET' as const,
    },
    {
      name: 'dashboard snapshot @ 50 conns (20s cache)',
      url: `${base}/workspaces/${workspaceId}/analytics/dashboard`,
      connections: 50,
      durationSeconds: 10,
      method: 'GET' as const,
    },
    {
      name: 'task creation @ 20 conns (write path with OCC)',
      url: `${base}/projects/${projectId}/tasks`,
      connections: 20,
      durationSeconds: 10,
      method: 'POST' as const,
      body: JSON.stringify({ title: 'Load generated task', priority: 'medium' }),
    },
  ]

  const results: ScenarioResult[] = []
  for (const scenario of scenarios) {
    logger.warn(
      `load: running "${scenario.name}" (${scenario.connections} connections, ${scenario.durationSeconds}s)`,
    )
    const result = await runLoad(
      scenario.url,
      accessToken,
      scenario.connections,
      scenario.durationSeconds,
      scenario.method,
      scenario.body,
    )
    const entry: ScenarioResult = {
      name: scenario.name,
      url: scenario.url.replace(/localhost:\d+/, 'localhost:<port>'),
      method: scenario.method,
      connections: scenario.connections,
      durationSeconds: scenario.durationSeconds,
      requestsPerSecond: Math.round(result.requests.average),
      latencyMs: {
        average: result.latency.average,
        p50: result.latency.p50,
        p97_5: result.latency.p97_5,
        p99: result.latency.p99,
      },
      totalRequests: result.requests.total,
      non2xx: result.non2xx,
      errors: result.errors,
      timeouts: result.timeouts,
    }
    results.push(entry)
    logger.warn(
      `load: "${entry.name}" → rps=${entry.requestsPerSecond} p50=${entry.latencyMs.p50}ms p97.5=${entry.latencyMs.p97_5}ms p99=${entry.latencyMs.p99}ms non2xx=${entry.non2xx}`,
    )
  }

  const report = {
    generatedAt: new Date().toISOString(),
    environment: {
      nodeVersion: process.version,
      platform: `${process.platform} ${process.arch}`,
      database: mongoose.connection.name,
      methodology:
        'autocannon against a single API process and single-node MongoDB on the same machine, ' +
        'seeded with the demo dataset at scale=4 (~190 tasks). Low-connection scenarios indicate ' +
        'per-request service time; high-connection scenarios show where the single process ' +
        'saturates. Numbers describe this machine, not production capacity.',
    },
    results,
  }

  const docsDir = path.resolve(env.apiRoot, '../../docs')
  await mkdir(docsDir, { recursive: true })
  await writeFile(
    path.join(docsDir, 'load-smoke-results.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  )
  logger.info('load: results written to docs/load-smoke-results.json')

  await new Promise<void>((resolve) => server.close(() => resolve()))
  await mongoose.connection.dropDatabase().catch(() => undefined)
  await disconnectDatabase()
}

main().catch((error) => {
  logger.error({ err: error }, 'load smoke failed')
  process.exit(1)
})
