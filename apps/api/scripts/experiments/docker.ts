/**
 * Docker-Compose harness for the production-topology experiments (exp7/exp8).
 *
 * Everything runs against the real `docker-compose.prod.yml` stack: Traefik
 * edge, api replicas, worker tier, 3-node MongoDB replica set, SeaweedFS.
 * The stack publishes only Traefik (port 80), so per-replica metrics are
 * scraped by executing a fetch *inside* each api container.
 */
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { env } from '../../src/config/env'
import { parsePrometheus, sleep } from './lib'

const run = promisify(execFile)

export const REPO_ROOT = path.resolve(env.apiRoot, '../..')
export const PROD_COMPOSE = ['-f', 'docker-compose.prod.yml']
export const EXP_COMPOSE = [...PROD_COMPOSE, '-f', 'docker-compose.exp.yml']
export const EXP_DEV_COMPOSE = [...PROD_COMPOSE, '-f', 'docker-compose.exp-dev.yml']
export const EXP_DEV_PRIMARY_COMPOSE = [
  ...PROD_COMPOSE,
  '-f',
  'docker-compose.exp-dev.yml',
  '-f',
  'docker-compose.exp-primary.yml',
]

export const TRAEFIK_URL = 'http://localhost'
export const API_BASE = `${TRAEFIK_URL}/api/v1`

/**
 * Fixed harness secret. A per-process random secret changes the api service
 * env on every experiment run, which makes `docker compose up` stop and
 * recreate every replica (a drain + fresh backend IPs) right before the first
 * measured scenario — polluting it with connection churn. This value is
 * dev-only benchmark tooling; it never reaches a real deployment.
 */
const HARNESS_JWT_SECRET = 'exp-harness-only-jwt-secret-32-chars-minimum'

/**
 * Compose runs with an explicit process env: the repo `.env` (development
 * values) must never leak into the production stack — shell environment wins
 * over `.env` during interpolation.
 */
export function composeEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    JWT_ACCESS_SECRET: HARNESS_JWT_SECRET,
    API_RATE_LIMIT_PER_MIN: '1000000',
    APP_URL: TRAEFIK_URL,
    CORS_ORIGINS: TRAEFIK_URL,
    ...extra,
  }
}

export async function compose(
  files: string[],
  args: string[],
  extraEnv: Record<string, string> = {},
): Promise<string> {
  const { stdout } = await run('docker', ['compose', ...files, ...args], {
    cwd: REPO_ROOT,
    env: composeEnv(extraEnv),
    maxBuffer: 128 * 1024 * 1024,
  })
  return stdout
}

export async function composeUp(files: string[], scale: number): Promise<void> {
  await compose(files, ['up', '-d', '--scale', `api=${scale}`, '--scale', 'worker=1'])
}

/** Scales back to the default topology (3 api replicas) after an A/B arm. */
export async function restoreProdTopology(scale = 3): Promise<void> {
  await composeUp(PROD_COMPOSE, scale)
  await waitForServiceHealthy('api', scale)
  await waitForTraefikConvergence()
}

export async function serviceContainerIds(files: string[], service: string): Promise<string[]> {
  const stdout = await compose(files, ['ps', '-q', service])
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

export async function containerName(id: string): Promise<string> {
  const { stdout } = await run('docker', ['inspect', '--format', '{{.Name}}', id])
  return stdout.trim().replace(/^\//, '')
}

export async function apiReplicaNames(files: string[] = PROD_COMPOSE): Promise<string[]> {
  const ids = await serviceContainerIds(files, 'api')
  return Promise.all(ids.map(containerName))
}

export async function serviceState(name: string): Promise<string> {
  const { stdout } = await run('docker', [
    'inspect',
    '--format',
    '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}',
    name,
  ])
  return stdout.trim()
}

export async function waitForServiceHealthy(
  service: string,
  count: number,
  timeoutMs = 240_000,
  files: string[] = PROD_COMPOSE,
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs
  let last = 'no attempt'
  while (Date.now() < deadline) {
    const ids = await serviceContainerIds(files, service)
    if (ids.length >= count) {
      const names = await Promise.all(ids.map(containerName))
      const states = await Promise.all(names.map(serviceState))
      if (states.every((state) => state === 'healthy')) return names
      last = `${names.length} replicas, states: ${states.join(', ')}`
    } else {
      last = `${ids.length} replicas found`
    }
    await sleep(3000)
  }
  throw new Error(`service ${service} never reached ${count} healthy replicas (${last})`)
}

export async function restartContainer(name: string, timeoutSeconds = 25): Promise<void> {
  await run('docker', ['restart', '-t', String(timeoutSeconds), name], { timeout: 150_000 })
}

export async function execCapture(name: string, cmd: string[]): Promise<string> {
  const { stdout } = await run('docker', ['exec', name, ...cmd], { maxBuffer: 128 * 1024 * 1024 })
  return stdout
}

export async function execNode(name: string, script: string): Promise<string> {
  return execCapture(name, ['node', '-e', script])
}

export async function mongosh(container: string, script: string): Promise<string> {
  return execCapture(container, ['mongosh', '--quiet', '--eval', script])
}

export async function restartCount(name: string): Promise<number> {
  const { stdout } = await run('docker', ['inspect', '--format', '{{.RestartCount}}', name])
  return Number.parseInt(stdout.trim(), 10)
}

/** Runs a one-off command in a fresh api container (seed, ensure-indexes, …). */
export async function runApiOneShot(
  files: string[],
  args: string[],
  containerEnv: Record<string, string> = {},
): Promise<string> {
  const envArgs = Object.entries(containerEnv).flatMap(([key, value]) => ['-e', `${key}=${value}`])
  return compose(files, ['run', '--rm', '--no-deps', '-T', ...envArgs, 'api', ...args])
}

const METRICS_JS =
  "fetch('http://127.0.0.1:4000/metrics').then(r=>r.text()).then(t=>process.stdout.write(t)).catch(e=>{console.error(String(e));process.exit(1)})"

export interface ReplicaSnapshot {
  name: string
  httpRequestsTotal: number | null
  cpuSeconds: number | null
  wsConnections: number | null
  cacheHits: number | null
  cacheMisses: number | null
  cacheCoalesced: number | null
  rssBytes: number | null
  restartCount: number
}

export async function snapshotReplica(name: string): Promise<ReplicaSnapshot> {
  const totals = parsePrometheus(await execNode(name, METRICS_JS))
  const cpuUser = totals.get('flowforge_process_cpu_user_seconds_total') ?? 0
  const cpuSystem = totals.get('flowforge_process_cpu_system_seconds_total') ?? 0
  return {
    name,
    httpRequestsTotal: totals.get('flowforge_http_requests_total') ?? null,
    cpuSeconds: cpuUser + cpuSystem,
    wsConnections: totals.get('flowforge_ws_connections') ?? null,
    cacheHits: totals.get('flowforge_cache_hits_total') ?? null,
    cacheMisses: totals.get('flowforge_cache_misses_total') ?? null,
    cacheCoalesced: totals.get('flowforge_cache_coalesced_total') ?? null,
    rssBytes: totals.get('flowforge_process_resident_memory_bytes') ?? null,
    restartCount: await restartCount(name),
  }
}

export const snapshotReplicas = (names: string[]): Promise<ReplicaSnapshot[]> =>
  Promise.all(names.map(snapshotReplica))

export const sumBy = <T>(items: T[], pick: (item: T) => number | null): number =>
  items.reduce((total, item) => total + (pick(item) ?? 0), 0)

/**
 * Waits until Traefik routes cleanly to the whole pool.
 *
 * Docker's healthcheck only reflects the containers; Traefik can keep pooled
 * backend connections to replicas that were just recreated or drained, and a
 * request sent onto such a connection hangs (no fast RST) instead of failing —
 * so experiments gate on a streak of fast probes through the edge before
 * starting a measured scenario.
 */
export async function waitForTraefikConvergence(timeoutMs = 120_000): Promise<number[]> {
  const probeUrl = `${TRAEFIK_URL}/api/v1/health/ready`
  const deadline = Date.now() + timeoutMs
  const latencies: number[] = []
  let cleanStreak = 0
  while (Date.now() < deadline) {
    const started = Date.now()
    let healthy = false
    try {
      const response = await fetch(probeUrl, { signal: AbortSignal.timeout(3000) })
      healthy = response.ok && (await response.text()).includes('"status":"ready"')
    } catch {
      healthy = false
    }
    const latency = Date.now() - started
    latencies.push(latency)
    cleanStreak = healthy && latency < 1000 ? cleanStreak + 1 : 0
    if (cleanStreak >= 8) return latencies.slice(-8)
    await sleep(1000)
  }
  throw new Error(
    `Traefik never converged after ${timeoutMs}ms — last probe latencies: ${latencies
      .slice(-10)
      .join(', ')}ms`,
  )
}

/** fetches task detail through Traefik and returns { id, version, status }. */
export async function getTaskViaTraefik(
  taskId: string,
  token: string,
): Promise<{ version: number; status: string }> {
  const response = await fetch(`${API_BASE}/tasks/${taskId}`, {
    headers: { authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`task fetch failed: ${response.status}`)
  const body = (await response.json()) as { task: { version: number; status: string } }
  return body.task
}

export async function createTaskViaTraefik(token: string, projectId: string): Promise<string> {
  const response = await fetch(`${API_BASE}/projects/${projectId}/tasks`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ title: `Cache-bust probe ${Date.now()}` }),
  })
  if (!response.ok) throw new Error(`task create failed: ${response.status}`)
  const body = (await response.json()) as { task: { id: string } }
  return body.task.id
}

// ---------------------------------------------------------------------------
// autocannon scenario with a status-code breakdown
// ---------------------------------------------------------------------------

export interface DetailedScenario {
  name: string
  url: string
  connections: number
  durationSeconds: number
  requestsPerSecond: number
  latencyMs: { average: number; p50: number; p97_5: number; p99: number; max: number }
  totalRequests: number
  non2xx: number
  errors: number
  timeouts: number
  statusCodeStats: Record<string, number>
}

interface AutocannonResult {
  latency: { average: number; p50: number; p97_5: number; p99: number; max: number }
  requests: { average: number; total: number }
  errors: number
  non2xx: number
  timeouts: number
  statusCodeStats?: Record<string, { count: number }>
}

const round1 = (value: number): number => Math.round(value * 10) / 10

export async function runDetailed(
  name: string,
  url: string,
  token: string,
  connections: number,
  durationSeconds: number,
): Promise<DetailedScenario> {
  const autocannon = (await import('autocannon')).default as unknown as (
    options: Record<string, unknown>,
  ) => Promise<AutocannonResult>
  const result = await autocannon({
    url,
    connections,
    duration: durationSeconds,
    pipelining: 1,
    headers: { authorization: `Bearer ${token}` },
  })
  const statusCodeStats: Record<string, number> = {}
  for (const [code, entry] of Object.entries(result.statusCodeStats ?? {})) {
    statusCodeStats[code] = entry.count
  }
  return {
    name,
    url: url.replace(TRAEFIK_URL, '<traefik>'),
    connections,
    durationSeconds,
    requestsPerSecond: Math.round(result.requests.average),
    latencyMs: {
      average: round1(result.latency.average),
      p50: round1(result.latency.p50),
      p97_5: round1(result.latency.p97_5),
      p99: round1(result.latency.p99),
      max: round1(result.latency.max),
    },
    totalRequests: result.requests.total,
    non2xx: result.non2xx,
    errors: result.errors,
    timeouts: result.timeouts,
    statusCodeStats,
  }
}
