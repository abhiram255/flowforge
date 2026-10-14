import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { Types } from 'mongoose'
import {
  addMemberViaInvitation,
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

/**
 * Tenant isolation is the highest-value property in a multi-tenant SaaS.
 * Every workspace-owned resource must be unreachable from a foreign account,
 * including via direct id manipulation — not just through the UI.
 */
describe('multi-tenant isolation', () => {
  let alice: TestUser
  let bob: TestUser
  let aliceWorkspaceId: string
  let bobWorkspaceId: string
  let bobProjectId: string
  let bobTaskId: string
  let bobAttachmentId: string

  beforeAll(async () => {
    await connectTestDatabase()

    alice = await registerUser({ name: 'Alice', email: 'alice@tenant.local' })
    bob = await registerUser({ name: 'Bob', email: 'bob@tenant.local' })

    const aliceWorkspace = await createWorkspaceFor(alice, 'Alice Space')
    const bobWorkspace = await createWorkspaceFor(bob, 'Bob Space')
    aliceWorkspaceId = aliceWorkspace.id
    bobWorkspaceId = bobWorkspace.id

    const bobProject = await createProjectFor(bob, bobWorkspace, { name: 'Bob Project', key: 'BOB' })
    bobProjectId = bobProject.id

    const bobTask = await createTaskFor(bob, bobProject, { title: 'Bob secret task' })
    bobTaskId = bobTask.id

    const upload = await request(app)
      .post(`/api/v1/tasks/${bobTaskId}/attachments`)
      .set(auth(bob.accessToken))
      .attach('file', Buffer.from('secret payload'), { filename: 'secret.txt', contentType: 'text/plain' })
    bobAttachmentId = upload.body.attachment.id
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it('lists only the workspaces the caller belongs to', async () => {
    const aliceList = await request(app).get('/api/v1/workspaces').set(auth(alice.accessToken))
    expect(aliceList.status).toBe(200)
    const ids = aliceList.body.data.map((workspace: { id: string }) => workspace.id)
    expect(ids).toContain(aliceWorkspaceId)
    expect(ids).not.toContain(bobWorkspaceId)
  })

  it('returns 404 (not 403) for a foreign workspace — existence is not leaked', async () => {
    const byId = await request(app)
      .get(`/api/v1/workspaces/${bobWorkspaceId}`)
      .set(auth(alice.accessToken))
    expect(byId.status).toBe(404)
    expect(byId.body.error.code).toBe('WORKSPACE_NOT_FOUND')
  })

  it('rejects foreign workspace access by slug too', async () => {
    const bobList = await request(app).get('/api/v1/workspaces').set(auth(bob.accessToken))
    const bobSlug = bobList.body.data[0].slug

    const bySlug = await request(app)
      .get(`/api/v1/workspaces/${bobSlug}`)
      .set(auth(alice.accessToken))
    expect(bySlug.status).toBe(404)
  })

  it('blocks reading foreign members, projects, tasks and activity', async () => {
    const members = await request(app)
      .get(`/api/v1/workspaces/${bobWorkspaceId}/members`)
      .set(auth(alice.accessToken))
    expect(members.status).toBe(404)

    const projects = await request(app)
      .get(`/api/v1/workspaces/${bobWorkspaceId}/projects`)
      .set(auth(alice.accessToken))
    expect(projects.status).toBe(404)

    const project = await request(app)
      .get(`/api/v1/projects/${bobProjectId}`)
      .set(auth(alice.accessToken))
    expect(project.status).toBe(404)

    const task = await request(app).get(`/api/v1/tasks/${bobTaskId}`).set(auth(alice.accessToken))
    expect(task.status).toBe(404)

    const activity = await request(app)
      .get(`/api/v1/workspaces/${bobWorkspaceId}/activity`)
      .set(auth(alice.accessToken))
    expect(activity.status).toBe(404)
  })

  it('blocks cross-tenant writes (update, delete, move)', async () => {
    const update = await request(app)
      .patch(`/api/v1/tasks/${bobTaskId}`)
      .set(auth(alice.accessToken))
      .send({ title: 'Hijacked', version: 0 })
    expect(update.status).toBe(404)

    const deleteTask = await request(app)
      .delete(`/api/v1/tasks/${bobTaskId}`)
      .set(auth(alice.accessToken))
    expect(deleteTask.status).toBe(404)

    const updateWorkspace = await request(app)
      .patch(`/api/v1/workspaces/${bobWorkspaceId}`)
      .set(auth(alice.accessToken))
      .send({ name: 'Hijacked space' })
    expect(updateWorkspace.status).toBe(404)

    const createTaskInForeignProject = await request(app)
      .post(`/api/v1/projects/${bobProjectId}/tasks`)
      .set(auth(alice.accessToken))
      .send({ title: 'Injected task' })
    expect(createTaskInForeignProject.status).toBe(404)
  })

  it('blocks cross-tenant attachment downloads', async () => {
    const download = await request(app)
      .get(`/api/v1/attachments/${bobAttachmentId}/download`)
      .set(auth(alice.accessToken))
    expect(download.status).toBe(404)

    const bobDownload = await request(app)
      .get(`/api/v1/attachments/${bobAttachmentId}/download`)
      .set(auth(bob.accessToken))
    expect(bobDownload.status).toBe(200)
  })

  it('blocks cross-tenant comments and analytics', async () => {
    const comment = await request(app)
      .post(`/api/v1/tasks/${bobTaskId}/comments`)
      .set(auth(alice.accessToken))
      .send({ content: 'sneaky' })
    expect(comment.status).toBe(404)

    const analytics = await request(app)
      .get(`/api/v1/workspaces/${bobWorkspaceId}/analytics`)
      .set(auth(alice.accessToken))
    expect(analytics.status).toBe(404)

    const dashboard = await request(app)
      .get(`/api/v1/workspaces/${bobWorkspaceId}/analytics/dashboard`)
      .set(auth(alice.accessToken))
    expect(analytics.status).toBe(404)
    expect(dashboard.status).toBe(404)
  })

  it('scopes task lists to the caller’s workspace', async () => {
    const aliceTasks = await request(app)
      .get(`/api/v1/tasks?workspaceId=${bobWorkspaceId}`)
      .set(auth(alice.accessToken))
    expect(aliceTasks.status).toBe(404)

    const foreignProject = await request(app)
      .get(`/api/v1/tasks?projectId=${bobProjectId}`)
      .set(auth(alice.accessToken))
    expect(foreignProject.status).toBe(404)
  })

  it('refuses to accept an invitation addressed to a different email', async () => {
    const inviteResponse = await request(app)
      .post(`/api/v1/workspaces/${bobWorkspaceId}/invitations`)
      .set(auth(bob.accessToken))
      .send({ email: 'someone-else@tenant.local', role: 'member' })
    expect(inviteResponse.status).toBe(201)

    const token = (inviteResponse.body.invitation.inviteUrl as string).split('/').pop() as string
    const attempt = await request(app)
      .post(`/api/v1/invitations/${token}/accept`)
      .set(auth(alice.accessToken))
      .send({})
    expect(attempt.status).toBe(403)
    expect(attempt.body.error.code).toBe('EMAIL_MISMATCH')
  })

  it('lets a legitimately invited user join, and only then access the workspace', async () => {
    const carol = await registerUser({ name: 'Carol', email: 'carol@tenant.local' })

    const before = await request(app)
      .get(`/api/v1/workspaces/${bobWorkspaceId}`)
      .set(auth(carol.accessToken))
    expect(before.status).toBe(404)

    await addMemberViaInvitation(bob, bobWorkspaceId, carol, 'member')

    const after = await request(app)
      .get(`/api/v1/workspaces/${bobWorkspaceId}`)
      .set(auth(carol.accessToken))
    expect(after.status).toBe(200)
    expect(after.body.workspace.role).toBe('member')
  })

  it('rejects unknown workspace ids with 404 and malformed ids with 400', async () => {
    const unknown = await request(app)
      .get(`/api/v1/workspaces/${new Types.ObjectId().toString()}`)
      .set(auth(alice.accessToken))
    expect(unknown.status).toBe(404)

    const malformed = await request(app)
      .get('/api/v1/tasks?projectId=not-an-id')
      .set(auth(alice.accessToken))
    expect(malformed.status).toBe(400)
  })
})
