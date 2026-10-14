import type { Server as HttpServer } from 'node:http'
import { createAdapter } from '@socket.io/redis-adapter'
import type IORedis from 'ioredis'
import { Server, type Socket } from 'socket.io'
import { env } from '../config/env'
import { logger } from '../config/logger'
import { getRedisClient } from '../config/redis'
import { wsConnectionsGauge } from '../lib/metrics'
import { verifyAccessToken } from '../lib/tokens'
import { isObjectId, uniq } from '../lib/utils'
import { loadWorkspaceContext } from '../middleware/workspace'
import { Project } from '../models/Project'

let io: Server | null = null

/** Dedicated pub/sub connections for the Redis adapter (closed on shutdown). */
let adapterClients: { pub: IORedis; sub: IORedis } | null = null

/**
 * Number of sockets currently in a workspace room.
 *
 * With the Redis adapter `fetchSockets()` spans every API instance, so presence
 * is correct across replicas instead of being per-process.
 */
async function workspaceOnlineCount(workspaceId: string): Promise<number> {
  if (!io) return 0
  try {
    const sockets = await io.in(`workspace:${workspaceId}`).fetchSockets()
    return sockets.length
  } catch {
    return 0
  }
}

interface SocketData {
  userId: string
  workspaceIds: Set<string>
  projectIds: Set<string>
}

const socketData = (socket: Socket): SocketData => socket.data as SocketData

/** Waits for a duplicate client to be ready before it is handed to the adapter. */
async function waitForRedisReady(client: IORedis, timeoutMs: number): Promise<boolean> {
  if (client.status === 'ready') return true
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs)
    client.once('ready', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

export async function initRealtime(httpServer: HttpServer): Promise<Server> {
  io = new Server(httpServer, {
    cors: { origin: env.corsOrigins, credentials: true },
    path: '/socket.io',
  })

  const redis = getRedisClient()
  if (redis) {
    // The application client disables the offline queue (fail fast when Redis is
    // down); the adapter's pub/sub clients must connect eagerly and buffer their
    // SUBSCRIBE until the connection is ready, so they get their own settings
    // (`lazyConnect` would otherwise leave them idle forever) and a readiness wait.
    const pub = redis.duplicate({ lazyConnect: false, enableOfflineQueue: true })
    const sub = redis.duplicate({ lazyConnect: false, enableOfflineQueue: true })
    const ready = await Promise.all([waitForRedisReady(pub, 5000), waitForRedisReady(sub, 5000)])
    if (ready.every(Boolean)) {
      io.adapter(createAdapter(pub, sub))
      adapterClients = { pub, sub }
      logger.info('Socket.IO Redis adapter enabled — rooms and events fan out across instances')
    } else {
      pub.disconnect()
      sub.disconnect()
      logger.warn('Redis adapter clients never became ready — realtime stays per-instance')
    }
  }

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined
      if (!token) throw new Error('missing token')
      const payload = verifyAccessToken(token)
      socket.data.userId = payload.sub
      socket.data.workspaceIds = new Set<string>()
      socket.data.projectIds = new Set<string>()
      next()
    } catch {
      next(new Error('TOKEN_INVALID'))
    }
  })

  io.on('connection', (socket) => {
    const data = socketData(socket)
    wsConnectionsGauge.inc()
    void socket.join(`user:${data.userId}`)
    logger.debug({ userId: data.userId }, 'realtime client connected')

    socket.on(
      'workspace:join',
      async (payload: { workspaceId?: string }, ack?: (response: unknown) => void) => {
        try {
          const ctx = await loadWorkspaceContext(data.userId, String(payload?.workspaceId ?? ''))
          const workspaceId = String(ctx.workspace._id)
          await socket.join(`workspace:${workspaceId}`)
          data.workspaceIds.add(workspaceId)
          const online = await workspaceOnlineCount(workspaceId)
          io?.to(`workspace:${workspaceId}`).emit('presence:update', { workspaceId, online })
          ack?.({ ok: true, workspaceId })
        } catch {
          ack?.({ ok: false, error: 'WORKSPACE_NOT_FOUND' })
        }
      },
    )

    socket.on(
      'project:join',
      async (payload: { projectId?: string }, ack?: (response: unknown) => void) => {
        try {
          const projectId = String(payload?.projectId ?? '')
          if (!isObjectId(projectId)) throw new Error('bad project id')
          const project = await Project.findById(projectId).select('workspaceId').lean()
          if (!project) throw new Error('not found')
          await loadWorkspaceContext(data.userId, String(project.workspaceId))
          await socket.join(`project:${projectId}`)
          data.projectIds.add(projectId)
          await broadcastProjectViewers(projectId)
          ack?.({ ok: true })
        } catch {
          ack?.({ ok: false, error: 'NOT_FOUND' })
        }
      },
    )

    socket.on('disconnect', () => {
      wsConnectionsGauge.dec()
      void (async () => {
        for (const workspaceId of data.workspaceIds) {
          const online = await workspaceOnlineCount(workspaceId)
          io?.to(`workspace:${workspaceId}`).emit('presence:update', { workspaceId, online })
        }
        for (const projectId of data.projectIds) {
          await broadcastProjectViewers(projectId)
        }
      })()
      logger.debug({ userId: data.userId }, 'realtime client disconnected')
    })
  })

  return io
}

async function broadcastProjectViewers(projectId: string): Promise<void> {
  if (!io) return
  const sockets = await io.in(`project:${projectId}`).fetchSockets()
  const viewers = uniq(sockets.map((socket) => String(socket.data.userId))).filter(Boolean)
  io.to(`project:${projectId}`).emit('presence:project', { projectId, viewers })
}

export function getIo(): Server | null {
  return io
}

/** Realtime events are emitted only after a successful database write. */
export function emitToWorkspace(workspaceId: string, event: string, payload: unknown): void {
  io?.to(`workspace:${workspaceId}`).emit(event, payload)
}

export function emitToProject(projectId: string, event: string, payload: unknown): void {
  io?.to(`project:${projectId}`).emit(event, payload)
}

export function emitToUser(userId: string, event: string, payload: unknown): void {
  io?.to(`user:${userId}`).emit(event, payload)
}

export async function closeRealtime(): Promise<void> {
  if (io) {
    await io.close()
    io = null
  }
  if (adapterClients) {
    adapterClients.pub.disconnect()
    adapterClients.sub.disconnect()
    adapterClients = null
  }
}
