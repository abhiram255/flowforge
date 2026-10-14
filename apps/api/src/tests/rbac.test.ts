import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
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

describe('role-based access control (server-side enforcement)', () => {
  let owner: TestUser
  let admin: TestUser
  let member: TestUser
  let viewer: TestUser
  let workspaceId: string
  let projectId: string
  let taskId: string

  beforeAll(async () => {
    await connectTestDatabase()
    owner = await registerUser({ name: 'Owner', email: 'owner@rbac.local' })
    admin = await registerUser({ name: 'Admin', email: 'admin@rbac.local' })
    member = await registerUser({ name: 'Member', email: 'member@rbac.local' })
    viewer = await registerUser({ name: 'Viewer', email: 'viewer@rbac.local' })

    const workspace = await createWorkspaceFor(owner, 'RBAC Workspace')
    workspaceId = workspace.id

    await addMemberViaInvitation(owner, workspaceId, admin, 'admin')
    await addMemberViaInvitation(owner, workspaceId, member, 'member')
    await addMemberViaInvitation(owner, workspaceId, viewer, 'viewer')

    const project = await createProjectFor(owner, workspace, { name: 'RBAC Project', key: 'RBAC' })
    projectId = project.id
    const task = await createTaskFor(owner, project, { title: 'RBAC task' })
    taskId = task.id
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it('viewer can read but every write is rejected with 403', async () => {
    const read = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/projects`)
      .set(auth(viewer.accessToken))
    expect(read.status).toBe(200)

    const createTask = await request(app)
      .post(`/api/v1/projects/${projectId}/tasks`)
      .set(auth(viewer.accessToken))
      .send({ title: 'Viewer task' })
    expect(createTask.status).toBe(403)

    const comment = await request(app)
      .post(`/api/v1/tasks/${taskId}/comments`)
      .set(auth(viewer.accessToken))
      .send({ content: 'viewer note' })
    expect(comment.status).toBe(403)

    const update = await request(app)
      .patch(`/api/v1/tasks/${taskId}`)
      .set(auth(viewer.accessToken))
      .send({ title: 'Viewer edit', version: 0 })
    expect(update.status).toBe(403)

    const upload = await request(app)
      .post(`/api/v1/tasks/${taskId}/attachments`)
      .set(auth(viewer.accessToken))
      .attach('file', Buffer.from('x'), { filename: 'x.txt', contentType: 'text/plain' })
    expect(upload.status).toBe(403)
  })

  it('member can create projects/tasks and collaborate', async () => {
    const project = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/projects`)
      .set(auth(member.accessToken))
      .send({ name: 'Member Project', key: 'MEM' })
    expect(project.status).toBe(201)

    const task = await request(app)
      .post(`/api/v1/projects/${projectId}/tasks`)
      .set(auth(member.accessToken))
      .send({ title: 'Member task' })
    expect(task.status).toBe(201)

    const comment = await request(app)
      .post(`/api/v1/tasks/${taskId}/comments`)
      .set(auth(member.accessToken))
      .send({ content: 'Member note' })
    expect(comment.status).toBe(201)
  })

  it('member cannot perform admin actions', async () => {
    const invite = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set(auth(member.accessToken))
      .send({ email: 'someone@rbac.local', role: 'admin' })
    expect(invite.status).toBe(403)

    const changeRole = await request(app)
      .patch(`/api/v1/workspaces/${workspaceId}/members/${viewer.id}`)
      .set(auth(member.accessToken))
      .send({ role: 'admin' })
    expect(changeRole.status).toBe(403)

    const archive = await request(app)
      .patch(`/api/v1/projects/${projectId}`)
      .set(auth(member.accessToken))
      .send({ status: 'archived' })
    expect(archive.status).toBe(403)

    const deleteProject = await request(app)
      .delete(`/api/v1/projects/${projectId}`)
      .set(auth(member.accessToken))
    expect(deleteProject.status).toBe(403)

    const deleteWorkspace = await request(app)
      .delete(`/api/v1/workspaces/${workspaceId}`)
      .set(auth(member.accessToken))
    expect(deleteWorkspace.status).toBe(403)

    const updateWorkspace = await request(app)
      .patch(`/api/v1/workspaces/${workspaceId}`)
      .set(auth(member.accessToken))
      .send({ name: 'Renamed by member' })
    expect(updateWorkspace.status).toBe(403)
  })

  it('elevated invitations are admin-only but plain members may still be invited', async () => {
    const elevated = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set(auth(member.accessToken))
      .send({ email: 'admin-invite@rbac.local', role: 'admin' })
    expect(elevated.status).toBe(403)

    const plain = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set(auth(member.accessToken))
      .send({ email: 'plain-invite@rbac.local', role: 'member' })
    expect(plain.status).toBe(201)
  })

  it('admin can invite and change roles, but cannot touch the owner', async () => {
    const invite = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set(auth(admin.accessToken))
      .send({ email: 'invited-by-admin@rbac.local', role: 'member' })
    expect(invite.status).toBe(201)

    const demote = await request(app)
      .patch(`/api/v1/workspaces/${workspaceId}/members/${member.id}`)
      .set(auth(admin.accessToken))
      .send({ role: 'viewer' })
    expect(demote.status).toBe(200)
    expect(demote.body.member.role).toBe('viewer')

    const promoteBack = await request(app)
      .patch(`/api/v1/workspaces/${workspaceId}/members/${member.id}`)
      .set(auth(admin.accessToken))
      .send({ role: 'member' })
    expect(promoteBack.status).toBe(200)

    const touchOwner = await request(app)
      .patch(`/api/v1/workspaces/${workspaceId}/members/${owner.id}`)
      .set(auth(admin.accessToken))
      .send({ role: 'member' })
    expect(touchOwner.status).toBe(403)

    // Admins cannot mint new owners (self-promotion is rejected even earlier).
    const stealOwnership = await request(app)
      .patch(`/api/v1/workspaces/${workspaceId}/members/${member.id}`)
      .set(auth(admin.accessToken))
      .send({ role: 'owner' })
    expect(stealOwnership.status).toBe(403)

    const selfPromotion = await request(app)
      .patch(`/api/v1/workspaces/${workspaceId}/members/${admin.id}`)
      .set(auth(admin.accessToken))
      .send({ role: 'owner' })
    expect(selfPromotion.status).toBe(400)
  })

  it('workspace settings can restrict invitations to admins', async () => {
    const updated = await request(app)
      .patch(`/api/v1/workspaces/${workspaceId}`)
      .set(auth(owner.accessToken))
      .send({ settings: { allowMemberInvites: false } })
    expect(updated.status).toBe(200)
    expect(updated.body.workspace.settings.allowMemberInvites).toBe(false)

    const memberInvite = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set(auth(member.accessToken))
      .send({ email: 'blocked@rbac.local', role: 'member' })
    expect(memberInvite.status).toBe(403)

    await request(app)
      .patch(`/api/v1/workspaces/${workspaceId}`)
      .set(auth(owner.accessToken))
      .send({ settings: { allowMemberInvites: true } })
  })

  it('guards the last owner: owner cannot leave, non-owners can', async () => {
    const ownerLeave = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/leave`)
      .set(auth(owner.accessToken))
    expect(ownerLeave.status).toBe(409)
    expect(ownerLeave.body.error.code).toBe('LAST_OWNER')

    const memberLeave = await request(app)
      .post(`/api/v1/workspaces/${workspaceId}/leave`)
      .set(auth(member.accessToken))
    expect(memberLeave.status).toBe(204)

    const afterLeave = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}`)
      .set(auth(member.accessToken))
    expect(afterLeave.status).toBe(404)
  })

  it('ownership transfer demotes the previous owner to admin', async () => {
    const transfer = await request(app)
      .patch(`/api/v1/workspaces/${workspaceId}/members/${admin.id}`)
      .set(auth(owner.accessToken))
      .send({ role: 'owner' })
    expect(transfer.status).toBe(200)
    expect(transfer.body.member.role).toBe('owner')

    const members = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/members`)
      .set(auth(admin.accessToken))
    const previousOwner = members.body.data.find(
      (entry: { userId: string }) => entry.userId === owner.id,
    )
    expect(previousOwner.role).toBe('admin')
  })
})
