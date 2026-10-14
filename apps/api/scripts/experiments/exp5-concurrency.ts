/**
 * Experiment 5 — Concurrent task updates.
 *
 * Fire N simultaneous writes at the same task from different users and prove
 * that optimistic concurrency control holds under contention: exactly one
 * winner per version, no lost updates, no duplicate realtime events, and a
 * final state that matches the last successful writer.
 *
 * Usage: tsx scripts/experiments/exp5-concurrency.ts
 */
import os from 'node:os'
import { io as ioClient, type Socket } from 'socket.io-client'
import { connectDatabase, disconnectDatabase } from '../../src/config/db'
import { logger } from '../../src/config/logger'
import { seedDatabase } from '../seed'
import {
  bootstrapDemoContext,
  dropDatabase,
  login,
  sleep,
  startApiInstance,
  writeArtifact,
} from './lib'

const MONGO_URI = process.env.MONGODB_URI_EXP5 ?? 'mongodb://127.0.0.1:27017/flowforge_exp5'
const PORT = 43401
const WRITERS = [
  'aarav.mehta@flowforge.dev',
  'priya.sharma@flowforge.dev',
  'rohan.gupta@flowforge.dev',
  'neha.verma@flowforge.dev',
  'divya.nair@flowforge.dev',
]
const PASSWORD = 'Password123!'

interface TaskState {
  id: string
  version: number
  title: string
  position: number
  status: string
}

const statusCounts = (statuses: number[]): Record<string, number> => {
  const counts: Record<string, number> = {}
  for (const status of statuses) counts[String(status)] = (counts[String(status)] ?? 0) + 1
  return counts
}

async function main(): Promise<void> {
  logger.warn('exp5: seeding dataset')
  await connectDatabase(MONGO_URI)
  await seedDatabase({ reset: true, scale: 1 })
  await disconnectDatabase()

  const instance = await startApiInstance({
    name: 'api-concurrency',
    port: PORT,
    mongoUri: MONGO_URI,
    redisUrl: null,
  })

  try {
    const base = instance.baseUrl
    const demo = await bootstrapDemoContext(base)
    const writerTokens = await Promise.all(WRITERS.map((email) => login(base, email, PASSWORD)))
    const viewerToken = await login(base, 'arjun.rao@flowforge.dev', PASSWORD)

    const headersFor = (token: string): Record<string, string> => ({
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    })

    // Dedicated probe task
    const created = await fetch(`${base}/projects/${demo.projectId}/tasks`, {
      method: 'POST',
      headers: headersFor(writerTokens[0] as string),
      body: JSON.stringify({ title: 'Concurrency probe', priority: 'medium', status: 'todo' }),
    })
    if (!created.ok) throw new Error(`probe task creation failed: ${created.status}`)
    const probe = ((await created.json()) as { task: TaskState }).task

    const getTask = async (): Promise<TaskState> => {
      const response = await fetch(`${base}/tasks/${probe.id}`, {
        headers: { authorization: `Bearer ${writerTokens[0]}` },
      })
      return ((await response.json()) as { task: TaskState }).task
    }

    const patch = async (
      token: string,
      body: Record<string, unknown>,
    ): Promise<{ status: number; body: Record<string, unknown> }> => {
      const response = await fetch(`${base}/tasks/${probe.id}`, {
        method: 'PATCH',
        headers: headersFor(token),
        body: JSON.stringify(body),
      })
      return { status: response.status, body: (await response.json()) as Record<string, unknown> }
    }

    // Socket observer counts every realtime event for the probe task.
    const socket: Socket = ioClient(instance.rootUrl, {
      auth: { token: writerTokens[0] },
      transports: ['websocket'],
    })
    const events: Array<{ at: number; version: number | null }> = []
    socket.on('task:updated', (payload: { task?: { id?: string; version?: number } }) => {
      if (payload?.task?.id === probe.id)
        events.push({ at: Date.now(), version: payload.task.version ?? null })
    })
    socket.on('task:created', () => undefined)
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve())
      socket.once('connect_error', (error) => reject(error))
    })
    await new Promise<void>((resolve) =>
      socket.emit('workspace:join', { workspaceId: demo.workspaceId }, () => resolve()),
    )
    await new Promise<void>((resolve) =>
      socket.emit('project:join', { projectId: demo.projectId }, () => resolve()),
    )
    await sleep(300)

    // ------------------------------------------------------------------
    // Scene A — same-version flights
    // ------------------------------------------------------------------
    const ROUNDS = 20
    const sceneA = {
      rounds: ROUNDS,
      writersPerRound: WRITERS.length,
      attempts: 0,
      successes: 0,
      conflicts: 0,
      forbidden: 0,
      serverErrors: 0,
      versionInvariantHolds: true,
      singleEventPerRound: true,
      perRound: [] as Array<{
        round: number
        statuses: Record<string, number>
        version: number
        events: number
      }>,
    }

    for (let round = 1; round <= ROUNDS; round += 1) {
      const before = await getTask()
      const eventsBefore = events.length
      const results = await Promise.all(
        WRITERS.map((_, index) =>
          patch(writerTokens[index] as string, {
            title: `Concurrency probe — round ${round} writer ${index}`,
            version: before.version,
          }),
        ),
      )
      const statuses = statusCounts(results.map((result) => result.status))
      sceneA.attempts += results.length
      sceneA.successes += statuses['200'] ?? 0
      sceneA.conflicts += statuses['409'] ?? 0
      sceneA.forbidden += statuses['403'] ?? 0
      sceneA.serverErrors +=
        (statuses['500'] ?? 0) + (statuses['502'] ?? 0) + (statuses['503'] ?? 0)
      await sleep(250)
      const after = await getTask()
      const roundEvents = events.length - eventsBefore
      if (after.version !== before.version + 1) sceneA.versionInvariantHolds = false
      if (roundEvents !== 1) sceneA.singleEventPerRound = false
      sceneA.perRound.push({ round, statuses, version: after.version, events: roundEvents })
    }

    // Viewer is rejected even under concurrency (server-side RBAC)
    const preViewer = await getTask()
    const viewerAttempt = await patch(viewerToken, {
      title: 'viewer attempt',
      version: preViewer.version,
    })
    const viewerRejected = viewerAttempt.status === 403

    // ------------------------------------------------------------------
    // Scene B — retrying writers (no lost updates)
    // ------------------------------------------------------------------
    const WRITERS_B = 5
    const UPDATES_PER_WRITER = 3
    const sceneB = {
      writers: WRITERS_B,
      updatesPerWriter: UPDATES_PER_WRITER,
      attempts: 0,
      successes: 0,
      conflicts: 0,
      serverErrors: 0,
      maxAttemptsPerUpdate: 0,
      latencyMs: [] as number[],
    }
    const startVersion = (await getTask()).version
    const eventsBeforeB = events.length

    await Promise.all(
      Array.from({ length: WRITERS_B }, async (_, writerIndex) => {
        const token = writerTokens[writerIndex] as string
        for (let update = 1; update <= UPDATES_PER_WRITER; update += 1) {
          let attempts = 0
          for (;;) {
            attempts += 1
            sceneB.attempts += 1
            const current = await getTask()
            const started = Date.now()
            const result = await patch(token, {
              title: `Scene B — writer ${writerIndex} update ${update}`,
              version: current.version,
            })
            if (result.status === 200) {
              sceneB.successes += 1
              sceneB.latencyMs.push(Date.now() - started)
              break
            }
            if (result.status === 409) {
              sceneB.conflicts += 1
              if (attempts > 8) throw new Error('writer exceeded retry budget')
              continue
            }
            sceneB.serverErrors += 1
            break
          }
          sceneB.maxAttemptsPerUpdate = Math.max(sceneB.maxAttemptsPerUpdate, attempts)
        }
      }),
    )
    await sleep(400)
    const finalTask = await getTask()
    const sceneBEvents = events.length - eventsBeforeB

    // ------------------------------------------------------------------
    // Scene C — concurrent moves (drag & drop simulation)
    // ------------------------------------------------------------------
    const preMove = await getTask()
    const moveTargets = [-10, -20, -30, -40]
    const moveResults = await Promise.all(
      moveTargets.map((position, index) =>
        patch(writerTokens[index] as string, { position, version: preMove.version }),
      ),
    )
    const moveStatuses = statusCounts(moveResults.map((result) => result.status))
    const afterMove = await getTask()
    const winnerIndex = moveResults.findIndex((result) => result.status === 200)
    const sceneC = {
      attempts: moveResults.length,
      statuses: moveStatuses,
      finalPosition: afterMove.position,
      winnerTarget: winnerIndex >= 0 ? moveTargets[winnerIndex] : null,
      positionMatchesWinner:
        winnerIndex >= 0 ? afterMove.position === moveTargets[winnerIndex] : false,
    }

    await sleep(400)
    const totalEvents = events.length
    socket.close()

    const expectedEvents = sceneA.successes + sceneB.successes + (moveStatuses['200'] ?? 0)
    const artifact = {
      experiment: 5,
      generatedAt: new Date().toISOString(),
      environment: {
        machine: `${os.cpus()[0]?.model} (${os.cpus().length} logical cores)`,
        node: process.version,
        apiInstances: 1,
        concurrencyControl:
          'optimistic concurrency control — PATCH must carry the task version, compare-and-set on {workspaceId, version}',
        methodology:
          'Real HTTP PATCHes from 5 different authenticated users plus one socket observer counting task:updated events. ' +
          'Scene A fires 6 simultaneous same-version writes in each of 20 rounds; Scene B runs 5 writers doing 3 updates ' +
          'each with a fetch-retry loop (the strategy the web client uses); Scene C moves one task four ways at once.',
      },
      sceneA: {
        ...sceneA,
        latencyNote: 'statuses are HTTP codes: 200 winner, 409 version conflict',
        perRound: sceneA.perRound,
      },
      sceneB: {
        writers: sceneB.writers,
        updatesPerWriter: sceneB.updatesPerWriter,
        attempts: sceneB.attempts,
        successes: sceneB.successes,
        conflicts: sceneB.conflicts,
        serverErrors: sceneB.serverErrors,
        maxAttemptsPerUpdate: sceneB.maxAttemptsPerUpdate,
        avgLatencyMs:
          sceneB.latencyMs.length > 0
            ? Math.round(
                (sceneB.latencyMs.reduce((sum, value) => sum + value, 0) /
                  sceneB.latencyMs.length) *
                  10,
              ) / 10
            : null,
        finalVersionExpected: startVersion + sceneB.successes,
        finalVersionActual: finalTask.version,
        eventsObserved: sceneBEvents,
      },
      sceneC,
      verdicts: {
        exactlyOneWinnerPerRound: sceneA.successes === ROUNDS,
        versionInvariantHolds: sceneA.versionInvariantHolds,
        noLostUpdates: finalTask.version === startVersion + sceneB.successes,
        noDuplicateEvents: totalEvents === expectedEvents,
        sceneBEventsMatch: sceneBEvents === sceneB.successes,
        singleEventPerRound: sceneA.singleEventPerRound,
        viewerRejected,
        noServerErrors: sceneA.serverErrors + sceneB.serverErrors === 0,
      },
      events: { observed: totalEvents, expectedFromSuccessfulWrites: expectedEvents },
    }

    const target = await writeArtifact('exp5-concurrency.json', artifact)
    logger.warn(`exp5: artifact written to ${target}`)
    logger.warn(
      `exp5: rounds=${ROUNDS} winners=${sceneA.successes} conflicts=${sceneA.conflicts} | scene B successes=${sceneB.successes} conflicts=${sceneB.conflicts} finalVersion=${finalTask.version} | events=${totalEvents}/${expectedEvents}`,
    )
  } finally {
    await instance.stopGracefully()
  }

  await dropDatabase(MONGO_URI)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error({ err: error }, 'exp5 failed')
    process.exit(1)
  })
