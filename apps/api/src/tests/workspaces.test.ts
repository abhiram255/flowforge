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

describe('workspaces, invitations and lifecycle', () => {
  let owner: TestUser
  let joiner: TestUser

  beforeAll(async () => {
    await connectTestDatabase()
    owner = await registerUser({ name: 'Ws Owner', email: 'ws-owner@test.local' })
    joiner = await registerUser({ name: 'Ws Joiner', email: 'ws-joiner@test.local' })
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it('creates a workspace with the creator as owner', async () => {
    const workspace = await createWorkspaceFor(owner, 'Lifecycle Workspace')
    expect(workspace.role).toBe('owner')
    expect(workspace.memberCount).toBe(1)
    expect(workspace.slug).toBe('lifecycle-workspace')

    const bySlug = await request(app)
      .get(`/api/v1/workspaces/${workspace.slug}`)
      .set(auth(owner.accessToken))
    expect(bySlug.status).toBe(200)
    expect(bySlug.body.workspace.id).toBe(workspace.id)

    const memberList = await request(app)
      .get(`/api/v1/workspaces/${workspace.id}/members`)
      .set(auth(owner.accessToken))
    expect(memberList.body.data).toHaveLength(1)
    expect(memberList.body.data[0].role).toBe('owner')
  })

  it('rejects duplicate slugs with 409', async () => {
    await createWorkspaceFor(owner, 'Slug Rights')
    const duplicate = await request(app)
      .post('/api/v1/workspaces')
      .set(auth(owner.accessToken))
      .send({ name: 'Something Else', slug: 'slug-rights' })

    expect(duplicate.status).toBe(409)
    expect(duplicate.body.error.code).toBe('DUPLICATE')
  })

  it('runs the full invitation lifecycle: invite → preview → accept → member', async () => {
    const workspace = await createWorkspaceFor(owner, 'Invite Workspace')

    const invite = await request(app)
      .post(`/api/v1/workspaces/${workspace.id}/invitations`)
      .set(auth(owner.accessToken))
      .send({ email: joiner.email, role: 'member' })
    expect(invite.status).toBe(201)
    const inviteUrl = invite.body.invitation.inviteUrl as string
    const token = inviteUrl.split('/').pop() as string

    const pending = await request(app)
      .get(`/api/v1/workspaces/${workspace.id}/invitations`)
      .set(auth(owner.accessToken))
    expect(pending.body.data).toHaveLength(1)
    expect(pending.body.data[0].email).toBe(joiner.email)

    // Preview is public — the invitee has not signed in yet.
    const preview = await request(app).get(`/api/v1/invitations/${token}`)
    expect(preview.status).toBe(200)
    expect(preview.body.invitation.workspaceName).toBe('Invite Workspace')

    const accept = await request(app)
      .post(`/api/v1/invitations/${token}/accept`)
      .set(auth(joiner.accessToken))
      .send({})
    expect(accept.status).toBe(200)
    expect(accept.body.workspace.id).toBe(workspace.id)

    const members = await request(app)
      .get(`/api/v1/workspaces/${workspace.id}/members`)
      .set(auth(owner.accessToken))
    expect(members.body.data).toHaveLength(2)

    // Inviter receives a notification.
    const notifications = await request(app)
      .get('/api/v1/notifications?limit=20')
      .set(auth(owner.accessToken))
    expect(
      notifications.body.data.some(
        (entry: { type: string }) => entry.type === 'invitation_accepted',
      ),
    ).toBe(true)

    // Re-using the same invitation is rejected.
    const reuse = await request(app)
      .post(`/api/v1/invitations/${token}/accept`)
      .set(auth(joiner.accessToken))
      .send({})
    expect(reuse.status).toBe(404)
  })

  it('revoked invitations cannot be accepted', async () => {
    const workspace = await createWorkspaceFor(owner, 'Revoke Workspace')
    const invite = await request(app)
      .post(`/api/v1/workspaces/${workspace.id}/invitations`)
      .set(auth(owner.accessToken))
      .send({ email: 'someone@revoke.local', role: 'member' })
    const token = (invite.body.invitation.inviteUrl as string).split('/').pop()

    await request(app)
      .delete(`/api/v1/workspaces/${workspace.id}/invitations/${invite.body.invitation.id}`)
      .set(auth(owner.accessToken))
      .expect(204)

    const preview = await request(app).get(`/api/v1/invitations/${token}`)
    expect(preview.status).toBe(404)
    expect(preview.body.error.code).toBe('INVITATION_INVALID')
  })

  it('re-inviting supersedes the previous pending invitation', async () => {
    const workspace = await createWorkspaceFor(owner, 'Reinvite Workspace')
    const first = await request(app)
      .post(`/api/v1/workspaces/${workspace.id}/invitations`)
      .set(auth(owner.accessToken))
      .send({ email: 'repeat@reinvite.local', role: 'member' })
    const second = await request(app)
      .post(`/api/v1/workspaces/${workspace.id}/invitations`)
      .set(auth(owner.accessToken))
      .send({ email: 'repeat@reinvite.local', role: 'viewer' })

    expect(second.status).toBe(201)
    expect(second.body.invitation.role).toBe('viewer')

    const pending = await request(app)
      .get(`/api/v1/workspaces/${workspace.id}/invitations`)
      .set(auth(owner.accessToken))
    expect(pending.body.data).toHaveLength(1)

    const staleToken = (first.body.invitation.inviteUrl as string).split('/').pop()
    const staleUse = await request(app).get(`/api/v1/invitations/${staleToken}`)
    expect(staleUse.status).toBe(404)
  })

  it('removing a member pulls them from task assignees', async () => {
    const workspace = await createWorkspaceFor(owner, 'Removal Workspace')
    await addMemberViaInvitation(owner, workspace.id, joiner, 'member')

    const project = await createProjectFor(owner, workspace, { name: 'Removal', key: 'REM' })
    const task = await createTaskFor(owner, project, {
      title: 'Assigned to joiner',
      assigneeIds: [joiner.id],
    })
    expect(task.assignees).toHaveLength(1)

    const removed = await request(app)
      .delete(`/api/v1/workspaces/${workspace.id}/members/${joiner.id}`)
      .set(auth(owner.accessToken))
    expect(removed.status).toBe(204)

    const after = await request(app).get(`/api/v1/tasks/${task.id}`).set(auth(owner.accessToken))
    expect(after.body.task.assignees).toHaveLength(0)

    const accessGone = await request(app)
      .get(`/api/v1/workspaces/${workspace.id}`)
      .set(auth(joiner.accessToken))
    expect(accessGone.status).toBe(404)
  })

  it('deleting a workspace cascades documents and removes access', async () => {
    const workspace = await createWorkspaceFor(owner, 'Doomed Workspace')
    await addMemberViaInvitation(owner, workspace.id, joiner, 'member')
    const project = await createProjectFor(owner, workspace, { name: 'Doomed', key: 'DOOM' })
    const task = await createTaskFor(owner, project, { title: 'Doomed task' })

    const deleted = await request(app)
      .delete(`/api/v1/workspaces/${workspace.id}`)
      .set(auth(owner.accessToken))
    expect(deleted.status).toBe(204)

    const goneWorkspace = await request(app)
      .get(`/api/v1/workspaces/${workspace.id}`)
      .set(auth(owner.accessToken))
    expect(goneWorkspace.status).toBe(404)

    const goneProject = await request(app)
      .get(`/api/v1/projects/${project.id}`)
      .set(auth(owner.accessToken))
    expect(goneProject.status).toBe(404)

    const goneTask = await request(app).get(`/api/v1/tasks/${task.id}`).set(auth(owner.accessToken))
    expect(goneTask.status).toBe(404)

    // The other member lost access too.
    const joinerList = await request(app).get('/api/v1/workspaces').set(auth(joiner.accessToken))
    const stillListed = joinerList.body.data.some(
      (entry: { id: string }) => entry.id === workspace.id,
    )
    expect(stillListed).toBe(false)
  })
})
