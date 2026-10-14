import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import request from 'supertest'
import type { WorkspaceDTO, ProjectDTO, TaskDTO } from '@flowforge/shared'
import { createApp } from '../app'
import { connectDatabase } from '../config/db'

export const app = createApp()

export function auth(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` }
}

export async function connectTestDatabase(): Promise<void> {
  if (mongoose.connection.readyState === 0) {
    await connectDatabase()
  }
  await clearDatabase()
}

/** Clears documents but keeps indexes so unique constraints stay in force. */
export async function clearDatabase(): Promise<void> {
  const db = mongoose.connection.db
  if (!db) return
  const collections = await db.collections()
  await Promise.all(collections.map((collection) => collection.deleteMany({})))
}

export async function disconnectTestDatabase(): Promise<void> {
  await mongoose.disconnect()
}

export interface TestUser {
  id: string
  email: string
  accessToken: string
  agent: ReturnType<typeof request.agent>
}

export async function registerUser(overrides: { name?: string; email?: string } = {}): Promise<TestUser> {
  const email = overrides.email ?? `user-${randomUUID()}@test.local`
  const agent = request.agent(app)
  const response = await agent
    .post('/api/v1/auth/register')
    .send({ name: overrides.name ?? 'Test User', email, password: 'Password123!' })
  if (response.status !== 201) {
    throw new Error(`register failed: ${response.status} ${JSON.stringify(response.body)}`)
  }
  return {
    id: response.body.user.id as string,
    email,
    accessToken: response.body.accessToken as string,
    agent,
  }
}

export async function createWorkspaceFor(user: TestUser, name = 'Test Workspace'): Promise<WorkspaceDTO> {
  const response = await request(app)
    .post('/api/v1/workspaces')
    .set(auth(user.accessToken))
    .send({ name })
  if (response.status !== 201) {
    throw new Error(`workspace create failed: ${response.status} ${JSON.stringify(response.body)}`)
  }
  return response.body.workspace as WorkspaceDTO
}

/** Runs the real invitation flow (create invite → accept) to add a member. */
export async function addMemberViaInvitation(
  inviter: TestUser,
  workspaceId: string,
  invitee: TestUser,
  role: 'admin' | 'member' | 'viewer' = 'member',
): Promise<void> {
  const inviteResponse = await request(app)
    .post(`/api/v1/workspaces/${workspaceId}/invitations`)
    .set(auth(inviter.accessToken))
    .send({ email: invitee.email, role })
  if (inviteResponse.status !== 201) {
    throw new Error(
      `invite failed: ${inviteResponse.status} ${JSON.stringify(inviteResponse.body)}`,
    )
  }
  const inviteUrl = inviteResponse.body.invitation.inviteUrl as string
  const token = inviteUrl.split('/').pop() as string
  const acceptResponse = await request(app)
    .post(`/api/v1/invitations/${token}/accept`)
    .set(auth(invitee.accessToken))
    .send({})
  if (acceptResponse.status !== 200) {
    throw new Error(`accept failed: ${acceptResponse.status} ${JSON.stringify(acceptResponse.body)}`)
  }
}

export async function createProjectFor(
  user: TestUser,
  workspace: { id: string },
  overrides: { name?: string; key?: string } = {},
): Promise<ProjectDTO> {
  const response = await request(app)
    .post(`/api/v1/workspaces/${workspace.id}/projects`)
    .set(auth(user.accessToken))
    .send({ name: overrides.name ?? 'Test Project', key: overrides.key ?? 'TST' })
  if (response.status !== 201) {
    throw new Error(`project create failed: ${response.status} ${JSON.stringify(response.body)}`)
  }
  return response.body.project as ProjectDTO
}

export async function createTaskFor(
  user: TestUser,
  project: { id: string },
  overrides: Partial<Record<string, unknown>> = {},
): Promise<TaskDTO> {
  const response = await request(app)
    .post(`/api/v1/projects/${project.id}/tasks`)
    .set(auth(user.accessToken))
    .send({ title: 'Test task', ...overrides })
  if (response.status !== 201) {
    throw new Error(`task create failed: ${response.status} ${JSON.stringify(response.body)}`)
  }
  return response.body.task as TaskDTO
}
