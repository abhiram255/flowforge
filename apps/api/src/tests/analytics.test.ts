import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
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

describe('analytics and dashboard', () => {
  let owner: TestUser
  let workspaceId: string
  let projectId: string

  beforeAll(async () => {
    await connectTestDatabase()
    owner = await registerUser({ name: 'Analyst', email: 'analyst@test.local' })

    const workspace = await createWorkspaceFor(owner, 'Analytics Workspace')
    workspaceId = workspace.id
    const project = await createProjectFor(owner, workspace, { name: 'Analytics', key: 'ANL' })
    projectId = project.id

    const tasks = await Promise.all([
      createTaskFor(owner, project, { title: 'Analytics one', assigneeIds: [owner.id] }),
      createTaskFor(owner, project, { title: 'Analytics two', assigneeIds: [owner.id] }),
      createTaskFor(owner, project, { title: 'Analytics three', priority: 'urgent' }),
      createTaskFor(owner, project, { title: 'Analytics four' }),
      createTaskFor(owner, project, { title: 'Analytics five', assigneeIds: [owner.id] }),
    ])

    // Complete two of them so completion metrics have signal.
    for (const task of tasks.slice(0, 2)) {
      await request(app)
        .patch(`/api/v1/tasks/${task.id}`)
        .set(auth(owner.accessToken))
        .send({ status: 'done', version: task.version })
        .expect(200)
    }
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it('returns correct aggregate analytics', async () => {
    const response = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/analytics?range=30`)
      .set(auth(owner.accessToken))
    expect(response.status).toBe(200)

    const analytics = response.body.analytics
    expect(analytics.overview.totalTasks).toBe(5)
    expect(analytics.overview.completedTasks).toBe(2)
    expect(analytics.overview.openTasks).toBe(3)
    expect(analytics.overview.completionRate).toBe(40)
    expect(analytics.overview.completedLast30d).toBe(2)

    const statusTotal = analytics.statusDistribution.reduce(
      (sum: number, slice: { count: number }) => sum + slice.count,
      0,
    )
    expect(statusTotal).toBe(5)

    expect(analytics.completionTrend).toHaveLength(30)
    const trendTotal = analytics.completionTrend.reduce(
      (sum: number, point: { completed: number }) => sum + point.completed,
      0,
    )
    expect(trendTotal).toBe(2)

    const workloadEntry = analytics.workload.find((entry: { userId: string }) => entry.userId === owner.id)
    expect(workloadEntry).toBeTruthy()
    expect(workloadEntry.open).toBe(1)

    const projectEntry = analytics.projects.find((entry: { id: string }) => entry.id === projectId)
    expect(projectEntry.total).toBe(5)
    expect(projectEntry.done).toBe(2)
  })

  it('serves analytics from cache within the TTL window', async () => {
    const first = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/analytics`)
      .set(auth(owner.accessToken))
    const second = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/analytics`)
      .set(auth(owner.accessToken))
    expect(first.body.analytics.generatedAt).toBe(second.body.analytics.generatedAt)
  })

  it('invalidates analytics cache after a task write', async () => {
    const before = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/analytics`)
      .set(auth(owner.accessToken))

    await createTaskFor(owner, { id: projectId }, { title: 'Cache buster' })

    const after = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/analytics`)
      .set(auth(owner.accessToken))
    expect(after.body.analytics.overview.totalTasks).toBe(before.body.analytics.overview.totalTasks + 1)
  })

  it('builds a personalised dashboard', async () => {
    await createTaskFor(owner, { id: projectId }, {
      title: 'Dashboard assigned',
      assigneeIds: [owner.id],
    })

    const response = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/analytics/dashboard`)
      .set(auth(owner.accessToken))
    expect(response.status).toBe(200)

    const dashboard = response.body.dashboard
    expect(dashboard.myOpenTasks).toBe(2)
    expect(dashboard.myCompletedThisWeek).toBe(2)
    expect(dashboard.projectCount).toBe(1)
    expect(dashboard.memberCount).toBe(1)
    expect(dashboard.assignedTasks).toHaveLength(2)
    expect(dashboard.recentActivity.length).toBeGreaterThan(0)
    expect(
      dashboard.recentActivity.some(
        (entry: { action: string }) => entry.action === 'task.created',
      ),
    ).toBe(true)
  })

  it('validates the analytics range parameter', async () => {
    const response = await request(app)
      .get(`/api/v1/workspaces/${workspaceId}/analytics?range=500`)
      .set(auth(owner.accessToken))
    expect(response.status).toBe(400)
  })
})
