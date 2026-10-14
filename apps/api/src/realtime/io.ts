import type { Server as HttpServer } from 'node:http'
import { Server, type Socket } from 'socket.io'
import { env } from '../config/env'
import { logger } from '../config/logger'
import { wsConnectionsGauge } from '../lib/metrics'
import { verifyAccessToken } from '../lib/tokens'
import { isObjectId, uniq } from '../lib/utils'
import { loadWorkspaceContext } from '../middleware/workspace'
import { Project } from '../models/Project'

let io: Server | null = null

/** workspaceId → userId → number of open sockets. */
const presence = new Map<string, Map<string, number>>()

function addPresence(workspaceId: string, userId: string): number {
  const map = presence.get(workspaceId) ?? new Map<string, number>()
  map.set(userId, (map.get(userId) ?? 0) + 1)
  presence.set(workspaceId, map)
  return [...map.values()].reduce((total, count) => total + count, 0)
}

function removePresence(workspaceId: string, userId: string): number {
  const map = presence.get(workspaceId)
  if (!map) return 0
  const remaining = (map.get(userId) ?? 1) - 1
  if (remaining <= 0) map.delete(userId)
  else map.set(userId, remaining)
  if (map.size === 0) presence.delete(workspaceId)
  return [...map.values()].reduce((total, count) => total + count, 0)
}

interface SocketData {
  userId: string
  workspaceIds: Set<string>
  projectIds: Set<string>
}

const socketData = (socket: Socket): SocketData => socket.data as SocketData

export function initRealtime(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: { origin: env.corsOrigins, credentials: true },
    path: '/socket.io',
  })

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

    socket.on('workspace:join', async (payload: { workspaceId?: string }, ack?: (response: unknown) => void) => {
      try {
        const ctx = await loadWorkspaceContext(data.userId, String(payload?.workspaceId ?? ''))
        const workspaceId = String(ctx.workspace._id)
        await socket.join(`workspace:${workspaceId}`)
        data.workspaceIds.add(workspaceId)
        const online = addPresence(workspaceId, data.userId)
        io?.to(`workspace:${workspaceId}`).emit('presence:update', { workspaceId, online })
        ack?.({ ok: true, workspaceId })
      } catch {
        ack?.({ ok: false, error: 'WORKSPACE_NOT_FOUND' })
      }
    })

    socket.on('project:join', async (payload: { projectId?: string }, ack?: (response: unknown) => void) => {
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
    })

    socket.on('disconnect', () => {
      wsConnectionsGauge.dec()
      for (const workspaceId of data.workspaceIds) {
        const online = removePresence(workspaceId, data.userId)
        io?.to(`workspace:${workspaceId}`).emit('presence:update', { workspaceId, online })
      }
      for (const projectId of data.projectIds) {
        void broadcastProjectViewers(projectId)
      }
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
  presence.clear()
}
