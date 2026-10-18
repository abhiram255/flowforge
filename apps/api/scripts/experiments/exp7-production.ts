/**
 * Experiment 7 — the production topology (docker-compose.prod.yml) under load.
 *
 * Sections (all measured through the real Traefik edge, api replicas and
 * SeaweedFS/MinIO-style object store; artifacts in
 * docs/experiments/exp7-production-topology.json):
 *
 *   A. Scaling efficiency: 1 vs 2 vs 3 api replicas behind Traefik
 *      (board + dashboard @50 connections), per-replica CPU.
 *   B. Rolling restart under load: one replica restarted mid-run, client
 *      error count and status-code breakdown (Traefik retry middleware on).
 *   C. Cross-replica realtime: the socket holder is identified via the
 *      ws-connections gauge, then the write is triggered on a *different*
 *      replica — the event must arrive (deterministic cross-instance proof).
 *   D. Shared attachments: upload via Traefik, then download from EVERY
 *      replica directly (proves the shared object store).
 *   E. Cache at N replicas: cold-key producer runs (per-process single-flight
 *      bound), and a negative-cache A/B against CACHE_DISABLED.
 *   F. Upload memory: 8 concurrent 10 MB uploads — per-replica RSS delta and
 *      restart count (streamed uploads never buffer in the heap).
 *
 * Honesty caveat: single-host setup — Traefik, api replicas, MongoDB (3
 * nodes), Redis, SeaweedFS and the load generator all share this machine's
 * CPU. Numbers describe this topology, not production capacity.
 */
import { setTimeout as delay } from 'node:timers/promises'
import { io as ioClient, type Socket } from 'socket.io-client'
import { logger } from '../../src/config/logger'
import {
  API_BASE,
  EXP_DEV_COMPOSE,
  PROD_COMPOSE,
  TRAEFIK_URL,
  apiReplicaNames,
  composeUp,
  createTaskViaTraefik,
  execNode,
  getTaskViaTraefik,
  restartContainer,
  restoreProdTopology,
  runApiOneShot,
  runDetailed,
  snapshotReplicas,
  sumBy,
  waitForServiceHealthy,
  waitForTraefikConvergence,
  type ReplicaSnapshot,
} from './docker'
import { bootstrapDemoContext, sleep, writeArtifact } from './lib'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** Scale, wait for Docker health AND for Traefik to route cleanly to the pool. */
async function scaleAndSettle(files: string[], scale: number): Promise<string[]> {
  await composeUp(files, scale)
  const names = await waitForServiceHealthy('api', scale, 240_000, files)
  await waitForTraefikConvergence()
  return names
}

const cpuPercent = (
  before: ReplicaSnapshot[],
  after: ReplicaSnapshot[],
  wallMs: number,
): number => {
  const delta = sumBy(after, (s) => s.cpuSeconds) - sumBy(before, (s) => s.cpuSeconds)
  return Math.round((delta / (wallMs / 1000)) * 1000) / 10
}

const rssMb = (bytes: number | null): number | null =>
  bytes === null ? null : Math.round((bytes / (1024 * 1024)) * 10) / 10

// ---------------------------------------------------------------------------
// A. Scaling efficiency
// ---------------------------------------------------------------------------

async function measureScale(
  scale: number,
  token: string,
  workspaceId: string,
  projectId: string,
): Promise<Record<string, unknown>> {
  const names = await scaleAndSettle(PROD_COMPOSE, scale)
  await sleep(2000)

  const before = await snapshotReplicas(names)
  const started = Date.now()
  const board = await runDetailed(
    `board @50 (${scale} replicas)`,
    `${API_BASE}/projects/${projectId}/tasks?sort=position`,
    token,
    50,
    15,
  )
  const dashboard = await runDetailed(
    `dashboard @50 (${scale} replicas)`,
    `${API_BASE}/workspaces/${workspaceId}/analytics/dashboard`,
    token,
    50,
    15,
  )
  const wallMs = Date.now() - started
  const after = await snapshotReplicas(names)
  return {
    replicas: names.length,
    replicaNames: names,
    combinedCpuPercentOfOneCore: cpuPercent(before, after, wallMs),
    wallMs,
    board,
    dashboard,
  }
}

// ---------------------------------------------------------------------------
// B. Rolling restart under load
// ---------------------------------------------------------------------------

async function rollingRestart(token: string, projectId: string): Promise<Record<string, unknown>> {
  const names = await scaleAndSettle(PROD_COMPOSE, 3)
  const target = names[names.length - 1] as string
  const loadPromise = runDetailed(
    'board @30 during replica restart',
    `${API_BASE}/projects/${projectId}/tasks?sort=position`,
    token,
    30,
    40,
  )
  await sleep(8000)
  const restartStarted = Date.now()
  await restartContainer(target, 25)
  const restartMs = Date.now() - restartStarted
  const load = await loadPromise
  // Let the pool and Traefik re-converge before the next section measures.
  await waitForTraefikConvergence()
  const restarts = await snapshotReplicas(names)
  return {
    restartedReplica: target,
    restartTookMs: restartMs,
    load,
    totalRequests: load.totalRequests,
    clientVisibleErrorPct: Math.round((load.non2xx / load.totalRequests) * 10000) / 100,
    restartCountsAfter: restarts.map((s) => ({ name: s.name, restarts: s.restartCount })),
  }
}

// ---------------------------------------------------------------------------
// C. Cross-replica realtime
// ---------------------------------------------------------------------------

async function crossReplicaRealtime(
  token: string,
  workspaceId: string,
  taskId: string,
): Promise<Record<string, unknown>> {
  const socket: Socket = ioClient(TRAEFIK_URL, {
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
  })
  try {
    await new Promise<void>((resolve, reject) => {
      socket.on('connect', () => resolve())
      socket.on('connect_error', (error) => reject(error))
      setTimeout(() => reject(new Error('socket connect timeout')), 10_000)
    })
    const ack = await new Promise<{ ok?: boolean } | undefined>((resolve) => {
      socket.emit('workspace:join', { workspaceId }, resolve)
    })
    if (!ack?.ok) throw new Error('workspace:join failed')
    await sleep(500)

    const names = await apiReplicaNames()
    const snapshots = await snapshotReplicas(names)
    const holder = snapshots.find((s) => (s.wsConnections ?? 0) > 0)?.name ?? null
    const writer = names.find((name) => name !== holder) ?? null
    if (!holder || !writer) throw new Error('could not identify socket holder / writer replica')

    const task = await getTaskViaTraefik(taskId, token)
    const nextStatus = task.status === 'in_review' ? 'todo' : 'in_review'
    const receivedAt = Date.now()
    const received = new Promise<number>((resolve) => {
      socket.once('task:updated', () => resolve(Date.now() - receivedAt))
    })

    const body = { version: task.version, status: nextStatus }
    const js = `fetch('http://127.0.0.1:4000/api/v1/tasks/${taskId}',{method:'PATCH',headers:{authorization:'Bearer '+${JSON.stringify(
      token,
    )},'content-type':'application/json'},body:${JSON.stringify(JSON.stringify(body))}}).then(r=>process.stdout.write(String(r.status))).catch(e=>process.stdout.write('ERR'))`
    const writeStatus = (await execNode(writer, js)).trim()

    const latency = await Promise.race([received, delay(5000).then(() => -1)])
    return {
      socketHeldBy: holder,
      writeExecutedOn: writer,
      crossReplica: holder !== writer,
      writeStatus: Number(writeStatus),
      eventLatencyMs: latency,
    }
  } finally {
    socket.disconnect()
  }
}

// ---------------------------------------------------------------------------
// D. Shared attachments across replicas
// ---------------------------------------------------------------------------

async function sharedAttachments(token: string, taskId: string): Promise<Record<string, unknown>> {
  const content = `cross-replica probe ${Date.now()}`
  const form = new FormData()
  form.append('file', new Blob([content], { type: 'text/plain' }), 'probe.txt')
  const upload = await fetch(`${API_BASE}/tasks/${taskId}/attachments`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  })
  const uploadBody = (await upload.json()) as { attachment?: { id: string } }
  const attachmentId = uploadBody.attachment?.id
  if (upload.status !== 201 || !attachmentId) {
    throw new Error(`upload failed: ${upload.status} ${JSON.stringify(uploadBody)}`)
  }

  const viaTraefik = await fetch(`${API_BASE}/attachments/${attachmentId}/download`, {
    headers: { authorization: `Bearer ${token}` },
  })
  const viaTraefikBody = await viaTraefik.text()

  const names = await apiReplicaNames()
  const perReplica: Array<{ replica: string; status: number; bytes: number }> = []
  for (const name of names) {
    const js = `fetch('http://127.0.0.1:4000/api/v1/attachments/${attachmentId}/download',{headers:{authorization:'Bearer '+${JSON.stringify(
      token,
    )}}}).then(r=>r.text().then(t=>process.stdout.write(r.status+' '+t.length))).catch(e=>process.stdout.write('ERR 0'))`
    const output = (await execNode(name, js)).trim().split(' ')
    perReplica.push({
      replica: name,
      status: Number(output[0]),
      bytes: Number(output[1] ?? 0),
    })
  }

  return {
    attachmentId,
    uploadStatus: upload.status,
    viaTraefikStatus: viaTraefik.status,
    viaTraefikMatches: viaTraefikBody === content,
    perReplicaDownload: perReplica,
    sharedStoreProven: perReplica.every(
      (entry) => entry.status === 200 && entry.bytes === content.length,
    ),
  }
}

// ---------------------------------------------------------------------------
// E. Cache at N replicas
// ---------------------------------------------------------------------------

async function coldKeyProducers(
  token: string,
  workspaceId: string,
  projectId: string,
): Promise<Record<string, unknown>> {
  await createTaskViaTraefik(token, projectId) // busts the analytics cache keys
  const names = await apiReplicaNames()
  const before = await snapshotReplicas(names)
  const url = `${API_BASE}/workspaces/${workspaceId}/analytics?range=30`
  const statuses = await Promise.all(
    Array.from({ length: 12 }, () =>
      fetch(url, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.status),
    ),
  )
  const after = await snapshotReplicas(names)
  return {
    parallelRequests: 12,
    statuses: statuses.reduce<Record<string, number>>((acc, status) => {
      acc[String(status)] = (acc[String(status)] ?? 0) + 1
      return acc
    }, {}),
    // One producer per replica is the documented per-process single-flight bound.
    producerRunsAcrossReplicas:
      sumBy(after, (s) => s.cacheMisses) - sumBy(before, (s) => s.cacheMisses),
    coalescedAcrossReplicas:
      sumBy(after, (s) => s.cacheCoalesced) - sumBy(before, (s) => s.cacheCoalesced),
    perReplicaMissDelta: after.map((entry, index) => ({
      replica: entry.name,
      misses: (entry.cacheMisses ?? 0) - (before[index]?.cacheMisses ?? 0),
    })),
  }
}

async function negativeCacheArm(
  label: string,
  files: string[],
  token: string,
): Promise<Record<string, unknown>> {
  await scaleAndSettle(files, 3)
  const names = await apiReplicaNames(files)
  const before = await snapshotReplicas(names)
  // Valid ObjectId format, no such workspace: every request is a deliberate 404
  // (non-2xx by design) — the comparison is latency, throughput and DB work.
  const load = await runDetailed(
    `404 probes (${label})`,
    `${API_BASE}/workspaces/000000000000000000000000/analytics`,
    token,
    10,
    10,
  )
  const after = await snapshotReplicas(names)
  return {
    label,
    scenario: load,
    responses404: load.statusCodeStats['404'] ?? 0,
    cacheMissesDelta: sumBy(after, (s) => s.cacheMisses) - sumBy(before, (s) => s.cacheMisses),
  }
}

// ---------------------------------------------------------------------------
// F. Upload memory
// ---------------------------------------------------------------------------

async function uploadMemory(token: string, taskId: string): Promise<Record<string, unknown>> {
  const names = await apiReplicaNames()
  const before = await snapshotReplicas(names)
  const payload = new Uint8Array(10 * 1024 * 1024).fill(65)
  const uploads = Array.from({ length: 8 }, (_, index) => {
    const form = new FormData()
    form.append('file', new Blob([payload], { type: 'text/plain' }), `rss-probe-${index}.txt`)
    return fetch(`${API_BASE}/tasks/${taskId}/attachments`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    }).then((r) => r.status)
  })
  const statuses = await Promise.all(uploads)
  await sleep(2000)
  const after = await snapshotReplicas(names)
  return {
    concurrentUploads: 8,
    uploadSizeMb: 10,
    statuses: statuses.reduce<Record<string, number>>((acc, status) => {
      acc[String(status)] = (acc[String(status)] ?? 0) + 1
      return acc
    }, {}),
    rssMbPerReplica: after.map((entry, index) => ({
      replica: entry.name,
      beforeMb: rssMb(before[index]?.rssBytes ?? null),
      afterMb: rssMb(entry.rssBytes),
      deltaMb:
        Math.round(
          ((rssMb(entry.rssBytes) ?? 0) - (rssMb(before[index]?.rssBytes ?? null) ?? 0)) * 10,
        ) / 10,
    })),
    restartCountsAfter: after.map((entry) => ({ name: entry.name, restarts: entry.restartCount })),
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  logger.warn('exp7: production-topology experiment — every section runs through Traefik')

  await scaleAndSettle(PROD_COMPOSE, 3)
  await runApiOneShot(PROD_COMPOSE, ['node', 'apps/api/dist/scripts/seed.js'], {
    SEED_FORCE: 'true',
  })

  const ctx = await bootstrapDemoContext(API_BASE)
  const { token } = ctx

  logger.warn('exp7/A: scaling efficiency 1 → 2 → 3 replicas')
  const scaling = [] as Array<Record<string, unknown>>
  for (const scale of [1, 2, 3]) {
    scaling.push(await measureScale(scale, token, ctx.workspaceId, ctx.projectId))
  }

  logger.warn('exp7/B: rolling restart under load')
  const rolling = await rollingRestart(token, ctx.projectId)

  logger.warn('exp7/C: cross-replica realtime event')
  const realtime = await crossReplicaRealtime(token, ctx.workspaceId, ctx.taskId)

  logger.warn('exp7/D: shared attachments across replicas')
  const attachments = await sharedAttachments(token, ctx.taskId)

  logger.warn('exp7/E1: cold-key producers across replicas')
  const coldKey = await coldKeyProducers(token, ctx.workspaceId, ctx.projectId)

  logger.warn('exp7/F: concurrent upload memory')
  const uploads = await uploadMemory(token, ctx.taskId)

  logger.warn('exp7/E2: negative-cache A/B (cache on vs CACHE_DISABLED)')
  const negativeCacheOn = await negativeCacheArm(
    'cache on (negative caching active)',
    PROD_COMPOSE,
    token,
  )
  const negativeCacheOff = await negativeCacheArm('CACHE_DISABLED=true', EXP_DEV_COMPOSE, token)

  logger.warn('exp7: restoring the production topology (3 replicas)')
  await restoreProdTopology(3)

  const dockerVersion = (
    await run('docker', ['version', '--format', '{{.Server.Version}}'])
  ).stdout.trim()
  const artifact = {
    experiment: 'exp7-production-topology',
    generatedAt: new Date().toISOString(),
    environment: {
      dockerEngine: dockerVersion,
      topology: 'docker-compose.prod.yml (Traefik edge, 3-node Mongo RS, SeaweedFS, worker tier)',
      caveat:
        'Single host: load generator, Traefik, api replicas, MongoDB nodes, Redis and SeaweedFS share one CPU. Numbers describe this topology, not production capacity.',
      rateLimit: 'API_RATE_LIMIT_PER_MIN raised for the run (default 600 would 429 the generator)',
    },
    scaling,
    rollingRestart: rolling,
    crossReplicaRealtime: realtime,
    sharedAttachments: attachments,
    coldKeyProducers: coldKey,
    negativeCache: { cacheOn: negativeCacheOn, cacheDisabled: negativeCacheOff },
    uploadMemory: uploads,
  }
  const target = await writeArtifact('exp7-production-topology.json', artifact)
  logger.warn(`exp7: artifact written to ${target}`)
}

main().catch((error) => {
  logger.error({ err: error }, 'exp7 failed')
  process.exit(1)
})
