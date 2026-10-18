/**
 * Shared harness for the six scalability experiments.
 *
 * Everything here is deliberately explicit so the numbers in
 * docs/SCALABILITY_EXPERIMENTS.md can be reproduced on a laptop:
 *
 *  - API instances are spawned as real child processes (not in-process),
 *    so CPU and throughput measurements are not distorted by the load generator.
 *  - The load balancer is a plain round-robin HTTP proxy with active health
 *    checks and one retry on connection failure for idempotent requests.
 *  - Metrics are scraped from each instance's Prometheus endpoint, so CPU,
 *    request counts and cache counters come from the processes themselves.
 *
 * Windows note: `child.kill('SIGTERM')` is TerminateProcess on Windows and
 * cannot run Node signal handlers, so graceful shutdown is triggered over the
 * IPC channel when available (see src/index.ts, dev/test only). On Linux the
 * same shutdown() path runs on SIGTERM.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http'
import { connect as netConnect, type AddressInfo } from 'node:net'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { env } from '../../src/config/env'

export const EXPERIMENTS_DIR = path.resolve(env.apiRoot, '../../docs/experiments')

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export async function writeArtifact(fileName: string, report: unknown): Promise<string> {
  await mkdir(EXPERIMENTS_DIR, { recursive: true })
  const target = path.join(EXPERIMENTS_DIR, fileName)
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return target
}

let cachedTsxCli: string | null = null

export function resolveTsxCli(): string {
  if (cachedTsxCli) return cachedTsxCli
  const require = createRequire(import.meta.url)
  const pkg = require.resolve('tsx/package.json')
  cachedTsxCli = path.join(path.dirname(pkg), 'dist', 'cli.mjs')
  return cachedTsxCli
}

// ---------------------------------------------------------------------------
// API instances
// ---------------------------------------------------------------------------

export interface ApiInstance {
  name: string
  port: number
  pid: number
  rootUrl: string
  baseUrl: string
  child: ChildProcess
  logs: string[]
  /** Graceful stop through the same shutdown() path used for SIGTERM. */
  stopGracefully(timeoutMs?: number): Promise<{ exited: boolean; ms: number }>
  /** Hard kill (TerminateProcess on Windows) — simulates a crash. */
  kill(): Promise<{ exited: boolean; ms: number }>
}

export interface StartInstanceOptions {
  name: string
  port: number
  mongoUri: string
  redisUrl?: string | null
  env?: Record<string, string>
  logLevel?: string
}

export async function startApiInstance(options: StartInstanceOptions): Promise<ApiInstance> {
  const childEnv: Record<string, string> = {
    ...(process.env as Record<string, string>),
    NODE_ENV: 'development',
    PORT: String(options.port),
    MONGODB_URI: options.mongoUri,
    LOG_LEVEL: options.logLevel ?? 'warn',
    RATE_LIMIT_DISABLED: 'true',
    COOKIE_SECURE: 'false',
    FORCE_COLOR: '0',
    ...options.env,
  }
  delete childEnv.REDIS_URL
  if (options.redisUrl) childEnv.REDIS_URL = options.redisUrl

  const child = spawn(process.execPath, [resolveTsxCli(), 'src/index.ts'], {
    cwd: env.apiRoot,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  })

  const logs: string[] = []
  const collect = (chunk: Buffer): void => {
    const text = chunk.toString('utf8')
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) logs.push(line)
    }
    if (logs.length > 400) logs.splice(0, logs.length - 400)
  }
  child.stdout?.on('data', collect)
  child.stderr?.on('data', collect)

  const rootUrl = `http://127.0.0.1:${options.port}`

  const instance: ApiInstance = {
    name: options.name,
    port: options.port,
    pid: child.pid ?? -1,
    rootUrl,
    baseUrl: `${rootUrl}/api/v1`,
    child,
    logs,
    async stopGracefully(timeoutMs = 15_000) {
      const started = Date.now()
      if (child.exitCode !== null) return { exited: true, ms: 0 }
      child.send?.('shutdown')
      const exited = await waitForExit(child, timeoutMs)
      if (!exited) child.kill()
      return { exited, ms: Date.now() - started }
    },
    async kill() {
      const started = Date.now()
      if (child.exitCode !== null) return { exited: true, ms: 0 }
      child.kill()
      const exited = await waitForExit(child, 10_000)
      return { exited, ms: Date.now() - started }
    },
  }

  await waitForHealthy(instance, 90_000)
  return instance
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

export async function waitForHealthy(instance: ApiInstance, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError = 'no attempt'
  while (Date.now() < deadline) {
    if (instance.child.exitCode !== null) {
      throw new Error(
        `instance ${instance.name} exited early (code ${instance.child.exitCode}):\n${instance.logs.join('\n')}`,
      )
    }
    try {
      const response = await fetch(`${instance.baseUrl}/health`, {
        signal: AbortSignal.timeout(1500),
      })
      if (response.ok) return
      lastError = `status ${response.status}`
    } catch (error) {
      lastError = (error as Error).message
    }
    await sleep(400)
  }
  throw new Error(
    `instance ${instance.name} never became healthy (${lastError}):\n${instance.logs.join('\n')}`,
  )
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export interface MetricsSnapshot {
  httpRequestsTotal: number | null
  cpuSeconds: number | null
  wsConnections: number | null
  cacheHits: number | null
  cacheMisses: number | null
  cacheCoalesced: number | null
}

export const parsePrometheus = (text: string): Map<string, number> => {
  const totals = new Map<string, number>()
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue
    const match = /^([a-zA-Z0-9_:]+)(?:\{[^}]*\})?\s+(-?[\d.e+]+)$/.exec(line.trim())
    if (!match) continue
    const name = match[1] as string
    const value = Number.parseFloat(match[2] as string)
    if (!Number.isFinite(value)) continue
    totals.set(name, (totals.get(name) ?? 0) + value)
  }
  return totals
}

export async function scrapeMetrics(
  instance: Pick<ApiInstance, 'rootUrl'>,
): Promise<MetricsSnapshot> {
  try {
    const response = await fetch(`${instance.rootUrl}/metrics`, {
      signal: AbortSignal.timeout(3000),
    })
    if (!response.ok) throw new Error(`status ${response.status}`)
    const totals = parsePrometheus(await response.text())
    const cpuUser = totals.get('flowforge_process_cpu_user_seconds_total') ?? 0
    const cpuSystem = totals.get('flowforge_process_cpu_system_seconds_total') ?? 0
    return {
      httpRequestsTotal: totals.get('flowforge_http_requests_total') ?? null,
      cpuSeconds: cpuUser + cpuSystem,
      wsConnections: totals.get('flowforge_ws_connections') ?? null,
      cacheHits: totals.get('flowforge_cache_hits_total') ?? null,
      cacheMisses: totals.get('flowforge_cache_misses_total') ?? null,
      cacheCoalesced: totals.get('flowforge_cache_coalesced_total') ?? null,
    }
  } catch {
    return {
      httpRequestsTotal: null,
      cpuSeconds: null,
      wsConnections: null,
      cacheHits: null,
      cacheMisses: null,
      cacheCoalesced: null,
    }
  }
}

/** CPU usage percent of one core between two snapshots. */
export const cpuPercent = (
  before: MetricsSnapshot,
  after: MetricsSnapshot,
  wallMs: number,
): number | null => {
  if (before.cpuSeconds === null || after.cpuSeconds === null) return null
  return Math.round(((after.cpuSeconds - before.cpuSeconds) / (wallMs / 1000)) * 1000) / 10
}

// ---------------------------------------------------------------------------
// autocannon scenarios
// ---------------------------------------------------------------------------

export interface ScenarioOptions {
  name: string
  url: string
  token: string
  connections: number
  durationSeconds: number
  method?: 'GET' | 'POST' | 'PATCH'
  body?: string
  /** Extra headers beyond authorization. */
  headers?: Record<string, string>
}

export interface ScenarioResult {
  name: string
  method: string
  url: string
  connections: number
  durationSeconds: number
  requestsPerSecond: number
  latencyMs: { average: number; p50: number; p97_5: number; p99: number }
  totalRequests: number
  non2xx: number
  errors: number
  timeouts: number
  cpuPercentOfOneCore: number | null
}

interface AutocannonResult {
  latency: { p50: number; p97_5: number; p99: number; average: number }
  requests: { average: number; total: number }
  errors: number
  non2xx: number
  timeouts: number
  duration: number
}

export async function runScenario(
  instance: Pick<ApiInstance, 'rootUrl'>,
  options: ScenarioOptions,
): Promise<ScenarioResult> {
  const autocannon = (await import('autocannon')).default as unknown as (
    options: Record<string, unknown>,
  ) => Promise<AutocannonResult>

  const before = await scrapeMetrics(instance)
  const started = Date.now()
  const result = await autocannon({
    url: options.url,
    method: options.method ?? 'GET',
    connections: options.connections,
    duration: options.durationSeconds,
    pipelining: 1,
    headers: {
      authorization: `Bearer ${options.token}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
    ...(options.body ? { body: options.body } : {}),
  })
  const after = await scrapeMetrics(instance)

  return {
    name: options.name,
    method: options.method ?? 'GET',
    url: options.url.replace(/localhost:\d+/, 'localhost:<port>'),
    connections: options.connections,
    durationSeconds: options.durationSeconds,
    requestsPerSecond: Math.round(result.requests.average),
    latencyMs: {
      average: round1(result.latency.average),
      p50: round1(result.latency.p50),
      p97_5: round1(result.latency.p97_5),
      p99: round1(result.latency.p99),
    },
    totalRequests: result.requests.total,
    non2xx: result.non2xx,
    errors: result.errors,
    timeouts: result.timeouts,
    cpuPercentOfOneCore: cpuPercent(before, after, Date.now() - started),
  }
}

const round1 = (value: number): number => Math.round(value * 10) / 10

// ---------------------------------------------------------------------------
// Demo data helpers
// ---------------------------------------------------------------------------

export interface DemoContext {
  token: string
  workspaceId: string
  secondWorkspaceId: string | null
  projectId: string
  taskId: string
}

export async function login(
  baseUrl: string,
  email = 'aarav.mehta@flowforge.dev',
  password = 'Password123!',
): Promise<string> {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!response.ok) throw new Error(`login failed for ${email}: ${response.status}`)
  const body = (await response.json()) as { accessToken: string }
  return body.accessToken
}

export async function bootstrapDemoContext(baseUrl: string): Promise<DemoContext> {
  const token = await login(baseUrl)
  const headers = { authorization: `Bearer ${token}` }
  const workspaces = (await (await fetch(`${baseUrl}/workspaces`, { headers })).json()) as {
    data: Array<{ id: string }>
  }
  const workspaceId = workspaces.data[0]!.id
  const secondWorkspaceId = workspaces.data[1]?.id ?? null
  const projects = (await (
    await fetch(`${baseUrl}/workspaces/${workspaceId}/projects`, { headers })
  ).json()) as { data: Array<{ id: string }> }
  const projectId = projects.data[0]!.id
  const tasks = (await (
    await fetch(`${baseUrl}/projects/${projectId}/tasks?sort=position`, { headers })
  ).json()) as { data: Array<{ id: string }> }
  const taskId = tasks.data[0]!.id
  return { token, workspaceId, secondWorkspaceId, projectId, taskId }
}

// ---------------------------------------------------------------------------
// Round-robin load balancer with active health checks
// ---------------------------------------------------------------------------

interface Upstream {
  name: string
  port: number
  host: string
  healthy: boolean
  consecutiveFailures: number
  requests: number
  retries: number
  errors: number
  ejectedAt: number | null
  rejoinedAt: number | null
}

export interface BalancerOptions {
  port: number
  upstreams: Array<{ name: string; port: number }>
  healthIntervalMs?: number
  healthPath?: string
}

export class RoundRobinBalancer {
  private server: Server
  private upstreams: Upstream[]
  private cursor = 0
  private healthTimer: NodeJS.Timeout | null = null
  readonly port: number
  readonly events: Array<{ at: number; event: string; upstream: string }> = []

  constructor(private options: BalancerOptions) {
    this.port = options.port
    this.upstreams = options.upstreams.map((upstream) => ({
      ...upstream,
      host: '127.0.0.1',
      healthy: true,
      consecutiveFailures: 0,
      requests: 0,
      retries: 0,
      errors: 0,
      ejectedAt: null,
      rejoinedAt: null,
    }))
    this.server = createServer((req, res) => this.handle(req, res))
    this.server.on('upgrade', (req, socket, head) => this.handleUpgrade(req, socket, head))
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`
  }

  /** Same-origin alias so the balancer can be passed where an instance is expected. */
  get rootUrl(): string {
    return this.url
  }

  async listen(): Promise<void> {
    await new Promise<void>((resolve) => this.server.listen(this.port, () => resolve()))
    const interval = this.options.healthIntervalMs ?? 1000
    this.healthTimer = setInterval(() => void this.checkHealth(), interval)
    await this.checkHealth()
  }

  async close(): Promise<void> {
    if (this.healthTimer) clearInterval(this.healthTimer)
    this.healthTimer = null
    await new Promise<void>((resolve) => {
      this.server.closeAllConnections?.()
      this.server.close(() => resolve())
    })
  }

  snapshot(): Array<{
    name: string
    healthy: boolean
    requests: number
    retries: number
    errors: number
  }> {
    return this.upstreams.map((upstream) => ({
      name: upstream.name,
      healthy: upstream.healthy,
      requests: upstream.requests,
      retries: upstream.retries,
      errors: upstream.errors,
    }))
  }

  private record(event: string, upstream: string): void {
    this.events.push({ at: Date.now(), event, upstream })
  }

  private async checkHealth(): Promise<void> {
    await Promise.all(
      this.upstreams.map(async (upstream) => {
        const path = this.options.healthPath ?? '/api/v1/health'
        try {
          const response = await fetch(`http://${upstream.host}:${upstream.port}${path}`, {
            signal: AbortSignal.timeout(800),
          })
          if (!response.ok) throw new Error(`status ${response.status}`)
          upstream.consecutiveFailures = 0
          if (!upstream.healthy) {
            upstream.healthy = true
            upstream.rejoinedAt = Date.now()
            this.record('upstream-rejoined', upstream.name)
          }
        } catch {
          upstream.consecutiveFailures += 1
          if (upstream.healthy && upstream.consecutiveFailures >= 2) {
            upstream.healthy = false
            upstream.ejectedAt = Date.now()
            this.record('upstream-ejected', upstream.name)
          }
        }
      }),
    )
  }

  private pick(): Upstream[] {
    const healthy = this.upstreams.filter((upstream) => upstream.healthy)
    const pool = healthy.length > 0 ? healthy : this.upstreams
    const ordered: Upstream[] = []
    for (let index = 0; index < pool.length; index += 1) {
      ordered.push(pool[(this.cursor + index) % pool.length] as Upstream)
    }
    this.cursor = (this.cursor + 1) % Math.max(pool.length, 1)
    return ordered
  }

  private handle(req: IncomingMessage, res: import('node:http').ServerResponse): void {
    const candidates = this.pick()
    const attempt = (index: number): void => {
      const upstream = candidates[index]
      if (!upstream) {
        res.statusCode = 502
        res.end('no upstream available')
        return
      }
      upstream.requests += 1
      const proxyReq = httpRequest(
        {
          host: upstream.host,
          port: upstream.port,
          path: req.url,
          method: req.method,
          headers: {
            ...req.headers,
            host: `${upstream.host}:${upstream.port}`,
            'x-forwarded-for': req.socket.remoteAddress ?? '127.0.0.1',
            'x-forwarded-proto': 'http',
          },
        },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers)
          proxyRes.pipe(res)
        },
      )
      proxyReq.on('error', () => {
        upstream.errors += 1
        const idempotent = req.method === 'GET' || req.method === 'HEAD'
        if (idempotent && index + 1 < candidates.length && !res.headersSent) {
          upstream.retries += 1
          this.record('request-retried', upstream.name)
          attempt(index + 1)
          return
        }
        if (res.headersSent) {
          res.destroy()
          return
        }
        res.statusCode = 502
        res.end('upstream error')
      })
      req.pipe(proxyReq)
    }
    attempt(0)
  }

  private handleUpgrade(
    req: IncomingMessage,
    socket: import('node:stream').Duplex,
    head: Buffer,
  ): void {
    const upstream = this.pick()[0]
    if (!upstream) {
      socket.destroy()
      return
    }
    const target = netConnect(upstream.port, upstream.host, () => {
      const headerLines = [`${req.method} ${req.url} HTTP/1.1`]
      for (let index = 0; index < req.rawHeaders.length; index += 2) {
        headerLines.push(`${req.rawHeaders[index]}: ${req.rawHeaders[index + 1]}`)
      }
      target.write(`${headerLines.join('\r\n')}\r\n\r\n`)
      if (head.length > 0) target.write(head)
      target.pipe(socket)
      socket.pipe(target)
    })
    target.on('error', () => socket.destroy())
    socket.on('error', () => target.destroy())
  }
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function port(): number {
  // Deterministic, high ports to avoid clashing with a developer's dev server.
  return 43100 + Math.floor(Math.random() * 500)
}

export async function dropDatabase(uri: string): Promise<void> {
  const mongoose = await import('mongoose')
  await mongoose.default.connect(uri)
  await mongoose.default.connection.dropDatabase()
  await mongoose.default.disconnect()
}

export function addressPort(server: Server): number {
  return (server.address() as AddressInfo).port
}
