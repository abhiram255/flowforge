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

describe('tasks: versioning, conflict handling, pagination and validation', () => {
  let owner: TestUser
  let member: TestUser
  let outsider: TestUser
  let workspaceId: string
  let projectId: string

  beforeAll(async () => {
    await connectTestDatabase()
    owner = await registerUser({ name: 'Task Owner', email: 'tasks-owner@test.local' })
    member = await registerUser({ name: 'Task Member', email: 'tasks-member@test.local' })
    outsider = await registerUser({ name: 'Outsider', email: 'tasks-outsider@test.local' })

    const workspace = await createWorkspaceFor(owner, 'Tasks Workspace')
    workspaceId = workspace.id
    await addMemberViaInvitation(owner, workspaceId, member, 'member')

    const project = await createProjectFor(owner, workspace, { name: 'Tasks Project', key: 'TSK' })
    projectId = project.id
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it('creates tasks with sequential human-readable keys', async () => {
    const first = await createTaskFor(owner, { id: projectId }, { title: 'First' })
    const second = await createTaskFor(owner, { id: projectId }, { title: 'Second' })

    expect(first.key).toBe('TSK-1')
    expect(second.key).toBe('TSK-2')
    expect(first.version).toBe(0)
    expect(first.status).toBe('todo')
  })

  it('rejects assignees who are not members of the workspace', async () => {
    const response = await request(app)
      .post(`/api/v1/projects/${projectId}/tasks`)
      .set(auth(owner.accessToken))
      .send({ title: 'Bad assignee', assigneeIds: [outsider.id] })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_FAILED')
  })

  it('accepts a workspace member as assignee and notifies them', async () => {
    const task = await createTaskFor(owner, { id: projectId }, {
      title: 'Assigned work',
      assigneeIds: [member.id],
    })
    expect(task.assignees.map((assignee) => assignee.id)).toContain(member.id)

    const notifications = await request(app)
      .get('/api/v1/notifications?limit=10')
      .set(auth(member.accessToken))
    const assigned = notifications.body.data.find(
      (notification: { type: string }) => notification.type === 'task_assigned',
    )
    expect(assigned).toBeTruthy()
    expect(assigned.title).toContain('TSK-')
  })

  it('implements optimistic concurrency control with version conflicts', async () => {
    const task = await createTaskFor(owner, { id: projectId }, { title: 'OCC base' })

    const ok = await request(app)
      .patch(`/api/v1/tasks/${task.id}`)
      .set(auth(owner.accessToken))
      .send({ title: 'OCC updated', version: task.version })
    expect(ok.status).toBe(200)
    expect(ok.body.task.version).toBe(task.version + 1)

    const stale = await request(app)
      .patch(`/api/v1/tasks/${task.id}`)
      .set(auth(owner.accessToken))
      .send({ title: 'Stale write', version: task.version })
    expect(stale.status).toBe(409)
    expect(stale.body.error.code).toBe('VERSION_CONFLICT')
    expect(stale.body.error.details.latestVersion).toBe(task.version + 1)
    expect(stale.body.error.details.latest.title).toBe('OCC updated')
  })

  it('serialises concurrent edits: exactly one of two same-version writes wins', async () => {
    const task = await createTaskFor(owner, { id: projectId }, { title: 'Race base' })

    const [a, b] = await Promise.all([
      request(app)
        .patch(`/api/v1/tasks/${task.id}`)
        .set(auth(owner.accessToken))
        .send({ title: 'Race A', version: task.version }),
      request(app)
        .patch(`/api/v1/tasks/${task.id}`)
        .set(auth(member.accessToken))
        .send({ title: 'Race B', version: task.version }),
    ])

    const statuses = [a.status, b.status].sort()
    expect(statuses).toEqual([200, 409])

    const winner = a.status === 200 ? a.body.task : b.body.task
    const final = await request(app).get(`/api/v1/tasks/${task.id}`).set(auth(owner.accessToken))
    expect(final.body.task.version).toBe(1)
    expect(final.body.task.title).toBe(winner.title)
  })

  it('tracks completion timestamps across status transitions', async () => {
    const task = await createTaskFor(owner, { id: projectId }, { title: 'Completable' })

    const done = await request(app)
      .patch(`/api/v1/tasks/${task.id}`)
      .set(auth(owner.accessToken))
      .send({ status: 'done', version: task.version })
    expect(done.body.task.completedAt).not.toBeNull()

    const reopened = await request(app)
      .patch(`/api/v1/tasks/${task.id}`)
      .set(auth(owner.accessToken))
      .send({ status: 'in_progress', version: done.body.task.version })
    expect(reopened.body.task.completedAt).toBeNull()
  })

  it('supports subtasks but rejects deep nesting', async () => {
    const parent = await createTaskFor(owner, { id: projectId }, { title: 'Parent' })
    const child = await createTaskFor(owner, { id: projectId }, {
      title: 'Child',
      parentTaskId: parent.id,
    })
    expect(child.parentTaskId).toBe(parent.id)

    const grandchild = await request(app)
      .post(`/api/v1/projects/${projectId}/tasks`)
      .set(auth(owner.accessToken))
      .send({ title: 'Grandchild', parentTaskId: child.id })
    expect(grandchild.status).toBe(400)

    const subtasks = await request(app)
      .get(`/api/v1/tasks/${parent.id}/subtasks`)
      .set(auth(owner.accessToken))
    expect(subtasks.body.data).toHaveLength(1)
    expect(subtasks.body.data[0].id).toBe(child.id)
  })

  it('excludes subtasks from board queries', async () => {
    const board = await request(app)
      .get(`/api/v1/projects/${projectId}/tasks?sort=position`)
      .set(auth(owner.accessToken))
    const hasSubtask = board.body.data.some((task: { parentTaskId: string | null }) => task.parentTaskId)
    expect(hasSubtask).toBe(false)
  })

  it('paginates with cursors: no duplicates, no gaps, stable walk', async () => {
    const workspaceResponse = await request(app)
      .get('/api/v1/workspaces')
      .set(auth(owner.accessToken))
    const workspace = workspaceResponse.body.data[0]

    const project = await createProjectFor(owner, workspace, { name: 'Paged', key: 'PAGE' })
    for (let index = 0; index < 7; index += 1) {
      await createTaskFor(owner, project, { title: `Paged task ${index}` })
    }

    const seen = new Set<string>()
    let cursor: string | null = null
    let pages = 0
    let hasMore = true
    while (hasMore) {
      const url: string = `/api/v1/projects/${project.id}/tasks?limit=3${
        cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
      }`
      const page: request.Response = await request(app).get(url).set(auth(owner.accessToken))
      expect(page.status).toBe(200)
      pages += 1
      for (const task of page.body.data as Array<{ id: string }>) {
        expect(seen.has(task.id)).toBe(false)
        seen.add(task.id)
      }
      hasMore = page.body.hasMore
      cursor = page.body.nextCursor
      expect(pages).toBeLessThan(6)
    }

    expect(seen.size).toBe(7)
    expect(pages).toBe(3)
  })

  it('filters by status, priority and full-text search', async () => {
    const project = await createProjectFor(owner, { id: workspaceId }, {
      name: 'Filtered',
      key: 'FLT',
    })
    await createTaskFor(owner, project, { title: 'Fix Zebra rendering', priority: 'urgent' })
    await createTaskFor(owner, project, { title: 'Polish Flamingo colours', priority: 'low' })

    const urgent = await request(app)
      .get(`/api/v1/projects/${project.id}/tasks?priority=urgent`)
      .set(auth(owner.accessToken))
    expect(urgent.body.data).toHaveLength(1)
    expect(urgent.body.data[0].priority).toBe('urgent')

    const search = await request(app)
      .get(`/api/v1/projects/${project.id}/tasks?q=Zebra`)
      .set(auth(owner.accessToken))
    expect(search.body.data).toHaveLength(1)
    expect(search.body.data[0].title).toContain('Zebra')
  })

  it('restricts deletion to the reporter or an admin', async () => {
    const task = await createTaskFor(owner, { id: projectId }, { title: 'Delete me' })

    const byMember = await request(app)
      .delete(`/api/v1/tasks/${task.id}`)
      .set(auth(member.accessToken))
    expect(byMember.status).toBe(403)

    const byReporter = await request(app)
      .delete(`/api/v1/tasks/${task.id}`)
      .set(auth(owner.accessToken))
    expect(byReporter.status).toBe(204)

    const gone = await request(app).get(`/api/v1/tasks/${task.id}`).set(auth(owner.accessToken))
    expect(gone.status).toBe(404)
  })

  it('deleting a parent removes its subtasks and their comments', async () => {
    const parent = await createTaskFor(owner, { id: projectId }, { title: 'Parent A' })
    const child = await createTaskFor(owner, { id: projectId }, {
      title: 'Child A',
      parentTaskId: parent.id,
    })
    await request(app)
      .post(`/api/v1/tasks/${child.id}/comments`)
      .set(auth(owner.accessToken))
      .send({ content: 'child comment' })
      .expect(201)

    await request(app).delete(`/api/v1/tasks/${parent.id}`).set(auth(owner.accessToken)).expect(204)

    const childAfter = await request(app).get(`/api/v1/tasks/${child.id}`).set(auth(owner.accessToken))
    expect(childAfter.status).toBe(404)
  })

  it('validates update payloads', async () => {
    const task = await createTaskFor(owner, { id: projectId }, { title: 'Body check' })

    const empty = await request(app)
      .patch(`/api/v1/tasks/${task.id}`)
      .set(auth(owner.accessToken))
      .send({ version: task.version })
    expect(empty.status).toBe(400)

    const noVersion = await request(app)
      .patch(`/api/v1/tasks/${task.id}`)
      .set(auth(owner.accessToken))
      .send({ title: 'No version' })
    expect(noVersion.status).toBe(400)
  })
})
