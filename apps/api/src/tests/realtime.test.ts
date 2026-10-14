import type { AddressInfo } from 'node:net'
import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { io as ioClient, type Socket } from 'socket.io-client'
import type { TaskDTO } from '@flowforge/shared'
import { closeRealtime, initRealtime } from '../realtime/io'
import {
  app,
  auth,
  connectTestDatabase,
  createProjectFor,
  createTaskFor,
  createWorkspaceFor,
  disconnectTestDatabase,
  registerUser,
  type TestUser,
} from './helpers'

function waitForEvent<T>(socket: Socket, event: string, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for "${event}"`)), timeoutMs)
    socket.once(event, (payload: T) => {
      clearTimeout(timer)
      resolve(payload)
    })
  })
}

async function connectSocket(url: string, token?: string): Promise<Socket> {
  const socket = ioClient(url, {
    auth: token ? { token } : {},
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  })
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket connect timeout')), 5000)
    socket.once('connect', () => {
      clearTimeout(timer)
      resolve()
    })
    socket.once('connect_error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
  return socket
}

describe('realtime collaboration', () => {
  let server: Server
  let url: string
  let owner: TestUser
  let stranger: TestUser
  let workspaceId: string
  let projectId: string

  beforeAll(async () => {
    await connectTestDatabase()
    owner = await registerUser({ name: 'Socket Owner', email: 'socket-owner@test.local' })
    stranger = await registerUser({ name: 'Socket Stranger', email: 'socket-stranger@test.local' })

    const workspace = await createWorkspaceFor(owner, 'Socket Workspace')
    workspaceId = workspace.id
    const project = await createProjectFor(owner, workspace, { name: 'Socket Project', key: 'SOCK' })
    projectId = project.id

    server = createServer(app)
    initRealtime(server)
    await new Promise<void>((resolve) => server.listen(0, () => resolve()))
    const address = server.address() as AddressInfo
    url = `http://localhost:${address.port}`
  })

  afterAll(async () => {
    await closeRealtime()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await disconnectTestDatabase()
  })

  it('rejects sockets without a valid access token', async () => {
    const socket = ioClient(url, {
      auth: {},
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    })
    const error = await new Promise<string>((resolve) => {
      socket.once('connect_error', (err) => resolve(err.message))
    })
    expect(error).toBe('TOKEN_INVALID')
    socket.close()
  })

  it('scopes room joins to workspace membership', async () => {
    const strangerWorkspace = await createWorkspaceFor(stranger, 'Stranger Space')
    const socket = await connectSocket(url, owner.accessToken)

    const own = await socket.emitWithAck('workspace:join', { workspaceId })
    expect(own.ok).toBe(true)

    const foreign = await socket.emitWithAck('workspace:join', {
      workspaceId: strangerWorkspace.id,
    })
    expect(foreign.ok).toBe(false)
    expect(foreign.error).toBe('WORKSPACE_NOT_FOUND')

    socket.close()
  })

  it('delivers task events to subscribed workspace members after a write', async () => {
    const socket = await connectSocket(url, owner.accessToken)
    const joined = await socket.emitWithAck('workspace:join', { workspaceId })
    expect(joined.ok).toBe(true)

    const createdEvent = waitForEvent<{ task: TaskDTO }>(socket, 'task:created')
    const task = await createTaskFor(owner, { id: projectId }, { title: 'Realtime task' })
    const created = await createdEvent
    expect(created.task.id).toBe(task.id)
    expect(created.task.key).toBe(task.key)

    const updatedEvent = waitForEvent<{ task: TaskDTO }>(socket, 'task:updated')
    await new Promise((resolve) => setTimeout(resolve, 50))
    const updateResponse = await import('supertest').then(({ default: supertest }) =>
      supertest(app)
        .patch(`/api/v1/tasks/${task.id}`)
        .set(auth(owner.accessToken))
        .send({ status: 'in_progress', version: task.version }),
    )
    expect(updateResponse.status).toBe(200)
    const updated = await updatedEvent
    expect(updated.task.status).toBe('in_progress')
    expect(updated.task.version).toBe(task.version + 1)

    socket.close()
  })

  it('broadcasts project presence to viewers of the same project', async () => {
    const socket = await connectSocket(url, owner.accessToken)
    const presence = waitForEvent<{ projectId: string; viewers: string[] }>(
      socket,
      'presence:project',
    )
    const joined = await socket.emitWithAck('project:join', { projectId })
    expect(joined.ok).toBe(true)

    const payload = await presence
    expect(payload.projectId).toBe(projectId)
    expect(payload.viewers).toContain(owner.id)
    socket.close()
  })
})
