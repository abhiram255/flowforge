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

describe('collaboration: comments, attachments, activity and notifications', () => {
  let owner: TestUser
  let member: TestUser
  let workspaceId: string
  let taskId: string

  beforeAll(async () => {
    await connectTestDatabase()
    owner = await registerUser({ name: 'Collab Owner', email: 'collab-owner@test.local' })
    member = await registerUser({ name: 'Collab Member', email: 'collab-member@test.local' })

    const workspace = await createWorkspaceFor(owner, 'Collab Workspace')
    workspaceId = workspace.id
    await addMemberViaInvitation(owner, workspaceId, member, 'member')

    const project = await createProjectFor(owner, workspace, { name: 'Collab', key: 'COL' })
    const task = await createTaskFor(owner, project, { title: 'Collaborate here' })
    taskId = task.id
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it('creates, lists, edits and deletes comments with correct permissions', async () => {
    const created = await request(app)
      .post(`/api/v1/tasks/${taskId}/comments`)
      .set(auth(member.accessToken))
      .send({ content: 'First thought on this task' })
    expect(created.status).toBe(201)
    expect(created.body.comment.author.id).toBe(member.id)
    const commentId = created.body.comment.id

    const list = await request(app)
      .get(`/api/v1/tasks/${taskId}/comments`)
      .set(auth(owner.accessToken))
    expect(list.status).toBe(200)
    expect(list.body.data).toHaveLength(1)

    const edited = await request(app)
      .patch(`/api/v1/comments/${commentId}`)
      .set(auth(member.accessToken))
      .send({ content: 'Edited thought' })
    expect(edited.status).toBe(200)
    expect(edited.body.comment.editedAt).not.toBeNull()

    const foreignEdit = await request(app)
      .patch(`/api/v1/comments/${commentId}`)
      .set(auth(owner.accessToken))
      .send({ content: 'Owner overwrite' })
    expect(foreignEdit.status).toBe(403)

    // Deleting, unlike editing, is a moderation action — admins may do it.
    const moderatorDelete = await request(app)
      .delete(`/api/v1/comments/${commentId}`)
      .set(auth(owner.accessToken))
    expect(moderatorDelete.status).toBe(204)

    const remaining = await request(app)
      .get(`/api/v1/tasks/${taskId}/comments`)
      .set(auth(owner.accessToken))
    expect(remaining.body.data).toHaveLength(0)

    // Authors can always delete their own comments.
    const second = await request(app)
      .post(`/api/v1/tasks/${taskId}/comments`)
      .set(auth(member.accessToken))
      .send({ content: 'Second comment' })
    const deleted = await request(app)
      .delete(`/api/v1/comments/${second.body.comment.id}`)
      .set(auth(member.accessToken))
    expect(deleted.status).toBe(204)
  })

  it('notifies task watchers about new comments', async () => {
    await request(app)
      .post(`/api/v1/tasks/${taskId}/comments`)
      .set(auth(member.accessToken))
      .send({ content: 'Ping for review' })

    const notifications = await request(app)
      .get('/api/v1/notifications?limit=20')
      .set(auth(owner.accessToken))
    const commentNotification = notifications.body.data.find(
      (entry: { type: string }) => entry.type === 'task_commented',
    )
    expect(commentNotification).toBeTruthy()
  })

  it('uploads, lists, downloads and deletes attachments with type enforcement', async () => {
    const payload = Buffer.from('flowforge attachment payload')

    const upload = await request(app)
      .post(`/api/v1/tasks/${taskId}/attachments`)
      .set(auth(member.accessToken))
      .attach('file', payload, { filename: 'notes.txt', contentType: 'text/plain' })
    expect(upload.status).toBe(201)
    const attachment = upload.body.attachment
    expect(attachment.filename).toBe('notes.txt')
    expect(attachment.size).toBe(payload.length)

    const list = await request(app)
      .get(`/api/v1/tasks/${taskId}/attachments`)
      .set(auth(owner.accessToken))
    expect(list.body.data).toHaveLength(1)

    const download = await request(app)
      .get(`/api/v1/attachments/${attachment.id}/download`)
      .set(auth(owner.accessToken))
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => callback(null, Buffer.concat(chunks)))
      })
    expect(download.status).toBe(200)
    expect(download.headers['content-disposition']).toContain('attachment')
    expect(Buffer.compare(download.body as Buffer, payload)).toBe(0)

    const rejected = await request(app)
      .post(`/api/v1/tasks/${taskId}/attachments`)
      .set(auth(member.accessToken))
      .attach('file', Buffer.from('MZ'), {
        filename: 'malware.exe',
        contentType: 'application/x-msdownload',
      })
    expect(rejected.status).toBe(415)
    expect(rejected.body.error.code).toBe('UNSUPPORTED_FILE_TYPE')

    const deleted = await request(app)
      .delete(`/api/v1/attachments/${attachment.id}`)
      .set(auth(member.accessToken))
    expect(deleted.status).toBe(204)

    const afterDelete = await request(app)
      .get(`/api/v1/attachments/${attachment.id}/download`)
      .set(auth(owner.accessToken))
    expect(afterDelete.status).toBe(404)
  })

  it('records activity for every important mutation', async () => {
    const feed = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/activity?limit=50`)
      .set(auth(owner.accessToken))
    expect(feed.status).toBe(200)

    const actions = feed.body.data.map((entry: { action: string }) => entry.action)
    expect(actions).toContain('task.created')
    expect(actions).toContain('comment.created')
    expect(actions).toContain('attachment.uploaded')
    expect(actions).toContain('member.joined')
  })

  it('paginates the activity feed with cursors', async () => {
    const first = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/activity?limit=2`)
      .set(auth(owner.accessToken))
    expect(first.body.data).toHaveLength(2)
    expect(first.body.hasMore).toBe(true)

    const second = await request(app)
      .get(
        `/api/v1/workspaces/${workspaceId}/activity?limit=2&cursor=${encodeURIComponent(
          first.body.nextCursor,
        )}`,
      )
      .set(auth(owner.accessToken))
    expect(second.status).toBe(200)
    const firstIds = first.body.data.map((entry: { id: string }) => entry.id)
    const secondIds = second.body.data.map((entry: { id: string }) => entry.id)
    expect(secondIds.some((id: string) => firstIds.includes(id))).toBe(false)
  })

  it('exposes unread counts and read state transitions', async () => {
    const before = await request(app)
      .get('/api/v1/notifications/unread-count')
      .set(auth(owner.accessToken))
    expect(before.body.count).toBeGreaterThan(0)

    const list = await request(app)
      .get('/api/v1/notifications?limit=1')
      .set(auth(owner.accessToken))
    const notificationId = list.body.data[0].id

    await request(app)
      .post(`/api/v1/notifications/${notificationId}/read`)
      .set(auth(owner.accessToken))
      .expect(204)

    const after = await request(app)
      .get('/api/v1/notifications/unread-count')
      .set(auth(owner.accessToken))
    expect(after.body.count).toBe(before.body.count - 1)

    await request(app).post('/api/v1/notifications/read-all').set(auth(owner.accessToken)).expect(200)
    const final = await request(app)
      .get('/api/v1/notifications/unread-count')
      .set(auth(owner.accessToken))
    expect(final.body.count).toBe(0)
  })

  it('filters notifications by unreadOnly', async () => {
    await request(app)
      .post(`/api/v1/tasks/${taskId}/comments`)
      .set(auth(member.accessToken))
      .send({ content: 'Another ping' })

    const unread = await request(app)
      .get('/api/v1/notifications?unreadOnly=true')
      .set(auth(owner.accessToken))
    expect(unread.body.data.length).toBeGreaterThan(0)
    for (const entry of unread.body.data) {
      expect(entry.readAt).toBeNull()
    }
  })
})
