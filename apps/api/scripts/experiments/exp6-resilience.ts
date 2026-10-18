/**
 * Experiment 6 — Reliability under failure.
 *
 * Four failure drills against the running stack:
 *   A. graceful restart of one of two API instances during a load test
 *   B. hard crash (kill) of one instance under the same load, as the contrast
 *   C. killing a background worker mid-job (BullMQ, application queue settings)
 *   D. a websocket client surviving the loss of the instance it was connected to
 *
 * Usage: tsx scripts/experiments/exp6-resilience.ts
 */
import { spawn, type ChildProcess } from 'node:child_process'
import os from 'node:os'
import { Queue } from 'bullmq'
import IORedis from 'ioredis'
import { io as ioClient, type Socket } from 'socket.io-client'
import { connectDatabase, disconnectDatabase } from '../../src/config/db'
import { env } from '../../src/config/env'
import { logger } from '../../src/config/logger'
import { JOB_DEFAULT_OPTIONS, QUEUE_NAME } from '../../src/jobs/queue'
import { seedDatabase } from '../../src/scripts/seed'
import {
  bootstrapDemoContext,
  dropDatabase,
  resolveTsxCli,
  RoundRobinBalancer,
  scrapeMetrics,
  sleep,
  startApiInstance,
  writeArtifact,
  type ApiInstance,
} from './lib'

const MONGO_URI = process.env.MONGODB_URI_EXP6 ?? 'mongodb://127.0.0.1:27017/flowforge_exp6'
const REDIS_URL = process.env.REDIS_URL_EXP ?? 'redis://127.0.0.1:6379'
const A_PORT = 43501
const B_PORT = 43502
const LB_PORT = 43500
const LOAD_SECONDS = 30

interface WorkerProcess {
  child: ChildProcess
  lines: string[]
  events: Array<{ event: string; jobId?: string; attempt?: number; at: number }>
  killHard(): Promise<void>
}

function spawnHarnessWorker(): WorkerProcess {
  const child = spawn(
    process.execPath,
    [resolveTsxCli(), 'scripts/experiments/worker-harness.ts'],
    {
      cwd: env.apiRoot,
      env: { ...process.env, NODE_ENV: 'development', REDIS_URL, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )
  const lines: string[] = []
  const events: WorkerProcess['events'] = []
  const collect = (chunk: Buffer): void => {
    for (const line of chunk.toString('utf8').split(/\r?\n/)) {
      if (!line.trim()) continue
      lines.push(line)
      try {
        const parsed = JSON.parse(line) as { event: string; jobId?: string; attempt?: number }
        events.push({ ...parsed, at: Date.now() })
      } catch {
        /* non-JSON log line */
      }
    }
  }
  child.stdout?.on('data', collect)
  child.stderr?.on('data', collect)
  return {
    child,
    lines,
    events,
    async killHard() {
      if (child.exitCode !== null) return
      child.kill()
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 8000)
        child.once('exit', () => {
          clearTimeout(timer)
          resolve()
        })
      })
    },
  }
}

interface LoadRun {
  errors: number
  non2xx: number
  timeouts: number
  requestsPerSecond: number
  requestCount: number
  latencyP97_5: number
}

interface ChildLoad {
  startedAt: number
  done: Promise<LoadRun>
}

/**
 * Runs autocannon as a *child process*. Running it in-process starved the
 * orchestrator's timers (an 8s sleep took 38s), which made the scheduled kill
 * land after the load had finished. The child keeps this process's clock honest.
 */
function spawnLoad(
  url: string,
  token: string,
  connections: number,
  durationSeconds: number,
): ChildLoad {
  const startedAt = Date.now()
  const child = spawn(
    process.execPath,
    [
      resolveTsxCli(),
      'scripts/experiments/load-runner.ts',
      url,
      token,
      String(connections),
      String(durationSeconds),
    ],
    {
      cwd: env.apiRoot,
      env: { ...process.env, NODE_ENV: 'development', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )
  const done = new Promise<LoadRun>((resolve, reject) => {
    let buffer = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
    })
    child.on('exit', (code) => {
      const match = /RESULT (\{.*\})/.exec(buffer)
      if (!match) {
        reject(new Error(`load-runner produced no result (exit ${code}): ${buffer.slice(-400)}`))
        return
      }
      resolve(JSON.parse(match[1] as string) as LoadRun)
    })
  })
  return { startedAt, done }
}

async function main(): Promise<void> {
  logger.warn('exp6: seeding dataset')
  await connectDatabase(MONGO_URI)
  await seedDatabase({ reset: true, scale: 4 })
  await disconnectDatabase()

  let instanceA = await startApiInstance({
    name: 'api-a',
    port: A_PORT,
    mongoUri: MONGO_URI,
    redisUrl: REDIS_URL,
  })
  let instanceB = await startApiInstance({
    name: 'api-b',
    port: B_PORT,
    mongoUri: MONGO_URI,
    redisUrl: REDIS_URL,
  })
  const balancer = new RoundRobinBalancer({
    port: LB_PORT,
    upstreams: [
      { name: 'api-a', port: A_PORT },
      { name: 'api-b', port: B_PORT },
    ],
    healthIntervalMs: 500,
  })
  await balancer.listen()

  const demo = await bootstrapDemoContext(instanceA.baseUrl)
  const loadUrl = `${balancer.url}/api/v1/projects/${demo.projectId}/tasks?sort=position`

  const artifact: Record<string, unknown> = {}

  try {
    // ------------------------------------------------------------------
    // Part A — graceful restart under load
    // ------------------------------------------------------------------
    const loadA = spawnLoad(loadUrl, demo.token, 30, LOAD_SECONDS)
    const loadStartA = loadA.startedAt
    const timelineA: Array<{
      t: number
      healthyA: boolean
      healthyB: boolean
      errors: number
      retries: number
    }> = []
    const sample = setInterval(() => {
      const snapshot = balancer.snapshot()
      timelineA.push({
        t: Date.now(),
        healthyA: snapshot.find((entry) => entry.name === 'api-a')?.healthy ?? false,
        healthyB: snapshot.find((entry) => entry.name === 'api-b')?.healthy ?? false,
        errors: snapshot.reduce((sum, entry) => sum + entry.errors, 0),
        retries: snapshot.reduce((sum, entry) => sum + entry.retries, 0),
      })
    }, 500)

    await sleep(8000)
    const stopStarted = Date.now()
    const gracefulExit = await instanceA.stopGracefully()
    const requestDuringShutdown = await fetch(`${instanceB.baseUrl}/health`)

    const resultA = await loadA.done
    const loadEndA = Date.now()
    clearInterval(sample)
    const ejectEvent = balancer.events.find(
      (event) => event.event === 'upstream-ejected' && event.upstream === 'api-a',
    )

    artifact.partA_gracefulRestart = {
      loadSeconds: LOAD_SECONDS,
      connections: 30,
      loadTiming: {
        startedAt: loadStartA,
        resolvedAt: loadEndA,
        actualDurationMs: loadEndA - loadStartA,
        stopRequestedAt: stopStarted,
        stopRequestedSecondsIntoLoad: Math.round((stopStarted - loadStartA) / 100) / 10,
        timelineSamples: timelineA.length,
      },
      requests: {
        errors: resultA.errors,
        non2xx: resultA.non2xx,
        timeouts: resultA.timeouts,
        requestsPerSecond: resultA.requestsPerSecond,
        totalRequests: resultA.requestCount,
        latencyP97_5: resultA.latencyP97_5,
      },
      shutdown: {
        drainMs: gracefulExit.ms,
        exitedCleanly: gracefulExit.exited,
        survivorHealthyDuringShutdown: requestDuringShutdown.ok,
      },
      loadBalancer: {
        ejectedAfterMs: ejectEvent ? ejectEvent.at - stopStarted : null,
        events: balancer.events,
        totalRetries: balancer.snapshot().reduce((sum, entry) => sum + entry.retries, 0),
        timeline: timelineA,
      },
      verdict:
        resultA.errors === 0 && resultA.non2xx === 0 ? 'zero failed requests' : 'requests failed',
    }
    const ejectedAfterMs = ejectEvent ? ejectEvent.at - stopStarted : null
    logger.warn(
      `exp6: graceful restart → errors=${resultA.errors} non2xx=${resultA.non2xx} drainMs=${gracefulExit.ms} lbEjectMs=${ejectedAfterMs}`,
    )

    // ------------------------------------------------------------------
    // Part B — hard crash contrast
    // ------------------------------------------------------------------
    instanceA = await startApiInstance({
      name: 'api-a2',
      port: A_PORT,
      mongoUri: MONGO_URI,
      redisUrl: REDIS_URL,
    })
    await sleep(1200)
    const countersBeforeB = balancer
      .snapshot()
      .reduce(
        (sum, entry) => ({
          retries: sum.retries + entry.retries,
          errors: sum.errors + entry.errors,
        }),
        { retries: 0, errors: 0 },
      )
    const loadB = spawnLoad(loadUrl, demo.token, 30, 15)
    const loadStartB = loadB.startedAt
    await sleep(6000)
    const crashStarted = Date.now()
    const crashExit = await instanceA.kill()
    const resultB = await loadB.done
    const loadEndB = Date.now()
    const countersAfterB = balancer
      .snapshot()
      .reduce(
        (sum, entry) => ({
          retries: sum.retries + entry.retries,
          errors: sum.errors + entry.errors,
        }),
        { retries: 0, errors: 0 },
      )
    const crashEject = balancer.events.find(
      (event) =>
        event.event === 'upstream-ejected' &&
        event.upstream === 'api-a' &&
        event.at >= crashStarted,
    )

    artifact.partB_hardCrash = {
      loadSeconds: 15,
      connections: 30,
      loadTiming: {
        actualDurationMs: loadEndB - loadStartB,
        killedSecondsIntoLoad: Math.round((crashStarted - loadStartB) / 100) / 10,
      },
      requests: {
        errors: resultB.errors,
        non2xx: resultB.non2xx,
        timeouts: resultB.timeouts,
        requestsPerSecond: resultB.requestsPerSecond,
        totalRequests: resultB.requestCount,
        latencyP97_5: resultB.latencyP97_5,
      },
      loadBalancer: {
        retriesDuringRun: countersAfterB.retries - countersBeforeB.retries,
        upstreamErrorsDuringRun: countersAfterB.errors - countersBeforeB.errors,
        ejectedAfterMs: crashEject ? crashEject.at - crashStarted : null,
      },
      killMs: crashExit.ms,
      killedAt: crashStarted,
      verdict:
        resultB.errors + resultB.non2xx === 0
          ? 'no failed requests (retry covered it)'
          : 'failed requests observed',
      note: 'A hard crash terminates in-flight connections; the load balancer retries idempotent GETs once, so surviving requests fail only when they were mid-flight on the killed instance.',
    }
    logger.warn(`exp6: hard crash → errors=${resultB.errors} non2xx=${resultB.non2xx}`)

    // ------------------------------------------------------------------
    // Part C — worker killed mid-job
    // ------------------------------------------------------------------
    await instanceB.stopGracefully()
    const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null })
    const queue = new Queue(QUEUE_NAME, { connection, defaultJobOptions: JOB_DEFAULT_OPTIONS })
    await queue.obliterate({ force: true }).catch(() => undefined)

    const workerOne = spawnHarnessWorker()
    await sleep(2500)
    const JOBS = 20
    const enqueuedAt = Date.now()
    for (let index = 0; index < JOBS; index += 1) {
      await queue.add('experiment:sleep', { ms: 2000, index })
    }
    await sleep(6000)
    const startedBeforeKill = workerOne.events.filter((event) => event.event === 'start').length
    const doneBeforeKill = workerOne.events.filter((event) => event.event === 'done').length
    await workerOne.killHard()
    const killedAt = Date.now()
    const countsAfterKill = await queue.getJobCounts('active', 'waiting', 'completed', 'failed')

    const workerTwo = spawnHarnessWorker()
    const restartAt = Date.now()
    let completed = countsAfterKill.completed ?? 0
    let recoveryMs: number | null = null
    while (Date.now() - restartAt < 150_000) {
      const counts = await queue.getJobCounts('active', 'waiting', 'completed', 'failed')
      const doneNow = workerTwo.events.filter((event) => event.event === 'done').length
      if (recoveryMs === null && doneNow > 0) recoveryMs = Date.now() - restartAt
      completed = counts.completed ?? 0
      if (completed >= JOBS) break
      await sleep(1000)
    }
    await sleep(1500)
    const finalCounts = await queue.getJobCounts('active', 'waiting', 'completed', 'failed')
    const restarts = workerTwo.events.filter((event) => event.event === 'start').length
    await workerTwo.killHard()

    artifact.partC_workerKill = {
      queue: QUEUE_NAME,
      jobOptions: JOB_DEFAULT_OPTIONS,
      jobs: JOBS,
      jobDurationMs: 2000,
      killedWorker: {
        startedBeforeKill,
        doneBeforeKill,
        countsAfterKill,
      },
      recovery: {
        recoveryMs,
        completedAfterRecovery: finalCounts.completed ?? 0,
        failedAfterRecovery: finalCounts.failed ?? 0,
        jobsProcessedBySecondWorker: restarts,
        totalWallMs: killedAt - enqueuedAt,
      },
      verdict:
        (finalCounts.completed ?? 0) >= JOBS && (finalCounts.failed ?? 0) === 0
          ? 'no jobs lost'
          : 'jobs lost or failed',
      note:
        'The harness worker uses the application queue name, job options (3 attempts, exponential backoff) and worker ' +
        'concurrency from src/jobs/queue.ts; the application worker itself runs in-process with the API.',
    }
    logger.warn(
      `exp6: worker kill → completed=${finalCounts.completed}/${JOBS} failed=${finalCounts.failed} recovery=${recoveryMs}ms`,
    )
    await queue.obliterate({ force: true }).catch(() => undefined)
    await queue.close()
    await connection.quit().catch(() => undefined)
    await workerOne.killHard()

    // ------------------------------------------------------------------
    // Part D — websocket client survives losing its instance
    // ------------------------------------------------------------------
    instanceA = await startApiInstance({
      name: 'api-a3',
      port: A_PORT,
      mongoUri: MONGO_URI,
      redisUrl: REDIS_URL,
    })
    instanceB = await startApiInstance({
      name: 'api-b2',
      port: B_PORT,
      mongoUri: MONGO_URI,
      redisUrl: REDIS_URL,
    })
    await sleep(1200)

    const socket: Socket = ioClient(balancer.url, {
      auth: { token: demo.token },
      transports: ['websocket'],
    })
    let disconnects = 0
    let reconnects = 0
    let reconnectMs: number | null = null
    let disconnectedAt = 0
    socket.on('disconnect', () => {
      disconnects += 1
      disconnectedAt = Date.now()
    })
    socket.on('connect', () => {
      if (disconnects > 0) {
        reconnects += 1
        reconnectMs = Date.now() - disconnectedAt
      }
      void socket.emit('workspace:join', { workspaceId: demo.workspaceId })
    })
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve())
      socket.once('connect_error', (error) => reject(error))
    })
    await new Promise<void>((resolve) =>
      socket.emit('workspace:join', { workspaceId: demo.workspaceId }, () => resolve()),
    )
    await sleep(500)

    const metricsA = await scrapeMetrics(instanceA)
    const metricsB = await scrapeMetrics(instanceB)
    const hostIsA = (metricsA.wsConnections ?? 0) > (metricsB.wsConnections ?? 0)
    const host = hostIsA ? instanceA : instanceB
    const survivor = hostIsA ? instanceB : instanceA
    const hostName = hostIsA ? 'api-a3' : 'api-b2'

    const reconnectWait = new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => resolve(reconnectMs), 20_000)
      const check = setInterval(() => {
        if (reconnectMs !== null) {
          clearInterval(check)
          clearTimeout(timer)
          resolve(reconnectMs)
        }
      }, 200)
    })
    const hostStopStarted = Date.now()
    await host.stopGracefully()
    const hostStopMs = Date.now() - hostStopStarted
    const observedReconnectMs = await reconnectWait
    // After failover the client must still receive cross-instance events.
    await sleep(500)
    const tasks = (await (
      await fetch(`${survivor.baseUrl}/projects/${demo.projectId}/tasks?sort=position`, {
        headers: { authorization: `Bearer ${demo.token}` },
      })
    ).json()) as { data: Array<{ id: string; version: number; title: string }> }
    const probe = tasks.data[0]!
    const eventWait = new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 5000)
      socket.once('task:updated', () => {
        clearTimeout(timer)
        resolve(Date.now())
      })
    })
    const eventSentAt = Date.now()
    await fetch(`${survivor.baseUrl}/tasks/${probe.id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${demo.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        title: `${probe.title} (post-failover check)`,
        version: probe.version,
      }),
    })
    const eventAt = await eventWait
    socket.close()

    artifact.partD_socketReconnect = {
      hostInstance: hostName,
      gracefulStopMs: hostStopMs,
      disconnects,
      reconnects,
      reconnectMs: observedReconnectMs,
      receivedEventAfterFailover: eventAt !== null,
      eventLatencyAfterFailoverMs: eventAt !== null ? eventAt - eventSentAt : null,
      verdict:
        reconnects >= 1 && eventAt !== null
          ? 'client reconnected and resumed events'
          : 'client did not recover',
    }
    logger.warn(
      `exp6: socket failover → reconnects=${reconnects} in ${observedReconnectMs}ms, resummed=${eventAt !== null}`,
    )

    const target = await writeArtifact('exp6-resilience.json', {
      experiment: 6,
      generatedAt: new Date().toISOString(),
      environment: {
        machine: `${os.cpus()[0]?.model} (${os.cpus().length} logical cores)`,
        node: process.version,
        topology:
          'two API instances behind the round-robin load balancer with 500ms health checks and one retry for idempotent requests; Redis shared',
        methodology:
          'Load: autocannon against the load balancer. Part A stops one instance with the same shutdown() path SIGTERM ' +
          'triggers; Part B terminates one with a hard kill. Part C kills a BullMQ worker (application queue settings) ' +
          'mid-job and restarts it. Part D kills the instance hosting a websocket client and measures reconnection + ' +
          'post-failover event delivery.',
      },
      ...artifact,
    })
    logger.warn(`exp6: artifact written to ${target}`)
  } finally {
    await balancer.close()
    await instanceA.stopGracefully().catch(() => undefined)
    await instanceB.stopGracefully().catch(() => undefined)
    await sleep(300)
  }

  await dropDatabase(MONGO_URI)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error({ err: error }, 'exp6 failed')
    process.exit(1)
  })

export type { ApiInstance }
