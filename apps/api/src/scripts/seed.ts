/**
 * Deterministic demo dataset for local development, E2E tests and load tests.
 * Refused in production (see env validation and the guard below).
 *
 * Usage:  npm run seed              (idempotent: skips when users exist)
 *         SEED_RESET=true npm run seed   (wipe + reseed)
 */
import { connectDatabase, disconnectDatabase } from '../config/db'
import { env } from '../config/env'
import { logger } from '../config/logger'
import { hashPassword } from '../lib/password'
import { ActivityLog } from '../models/ActivityLog'
import { Attachment } from '../models/Attachment'
import { Comment } from '../models/Comment'
import { Invitation } from '../models/Invitation'
import { Membership } from '../models/Membership'
import { Notification } from '../models/Notification'
import { Project } from '../models/Project'
import { Session } from '../models/Session'
import { Task } from '../models/Task'
import { User } from '../models/User'
import { Workspace } from '../models/Workspace'
import { TASK_PRIORITIES, TASK_STATUSES, type Role } from '@flowforge/shared'

export const DEMO_PASSWORD = 'Password123!'

export interface SeedOptions {
  reset?: boolean
  /** Multiplies the number of tasks per project (load-testing aid). */
  scale?: number
}

const DAY_MS = 86_400_000

const PEOPLE: Array<{ name: string; email: string; role: Role }> = [
  { name: 'Aarav Mehta', email: 'aarav.mehta@flowforge.dev', role: 'owner' },
  { name: 'Priya Sharma', email: 'priya.sharma@flowforge.dev', role: 'admin' },
  { name: 'Rohan Gupta', email: 'rohan.gupta@flowforge.dev', role: 'member' },
  { name: 'Neha Verma', email: 'neha.verma@flowforge.dev', role: 'member' },
  { name: 'Arjun Rao', email: 'arjun.rao@flowforge.dev', role: 'viewer' },
  { name: 'Divya Nair', email: 'divya.nair@flowforge.dev', role: 'member' },
  { name: 'Sara Khan', email: 'sara.khan@flowforge.dev', role: 'owner' },
  { name: 'Kabir Singh', email: 'kabir.singh@flowforge.dev', role: 'admin' },
]

const TASK_TEMPLATES: Array<{
  title: string
  labels: string[]
  priority: (typeof TASK_PRIORITIES)[number]
}> = [
  { title: 'Set up CI pipeline for automated tests', labels: ['devops'], priority: 'high' },
  { title: 'Design onboarding empty states', labels: ['design', 'ux'], priority: 'medium' },
  {
    title: 'Fix flaky authentication integration test',
    labels: ['bug', 'auth'],
    priority: 'urgent',
  },
  { title: 'Add keyboard shortcuts to the board', labels: ['frontend'], priority: 'low' },
  { title: 'Audit bundle size and lazy-load routes', labels: ['performance'], priority: 'medium' },
  { title: 'Implement CSV export for analytics', labels: ['backend'], priority: 'medium' },
  { title: 'Tighten rate limiting on auth endpoints', labels: ['security'], priority: 'high' },
  { title: 'Improve empty board illustration', labels: ['design'], priority: 'low' },
  {
    title: 'Add optimistic updates for drag and drop',
    labels: ['frontend', 'ux'],
    priority: 'high',
  },
  { title: 'Document workspace role matrix', labels: ['docs'], priority: 'low' },
  { title: 'Instrument p95 latency metrics', labels: ['observability'], priority: 'high' },
  {
    title: 'Cache analytics aggregations in Redis',
    labels: ['performance', 'backend'],
    priority: 'medium',
  },
  {
    title: 'Write tenant isolation regression tests',
    labels: ['security', 'testing'],
    priority: 'urgent',
  },
  { title: 'Add avatar upload with image validation', labels: ['backend'], priority: 'medium' },
  { title: 'Refine notification copy and grouping', labels: ['ux'], priority: 'low' },
  { title: 'Handle refresh token reuse detection', labels: ['auth', 'security'], priority: 'high' },
  { title: 'Add subtask progress rollup to cards', labels: ['frontend'], priority: 'medium' },
  { title: 'Set up MongoDB index benchmarks', labels: ['performance', 'devops'], priority: 'high' },
  { title: 'Generate OpenAPI reference from routes', labels: ['docs'], priority: 'medium' },
  { title: 'Add workspace invite email template', labels: ['backend'], priority: 'low' },
  {
    title: 'Fix drag ghost overflow on iOS Safari',
    labels: ['bug', 'frontend'],
    priority: 'medium',
  },
  { title: 'Add activity feed pagination cursor', labels: ['backend'], priority: 'medium' },
  { title: 'Review contrast ratios for dark theme', labels: ['design', 'a11y'], priority: 'low' },
  { title: 'Ship weekly digest background job', labels: ['backend', 'jobs'], priority: 'low' },
]

export async function seedDatabase(options: SeedOptions = {}): Promise<void> {
  // Refused by default in production; SEED_FORCE=true is the explicit opt-in
  // for demo/staging stacks that run NODE_ENV=production.
  if (env.isProduction && !env.SEED_FORCE) {
    throw new Error('Refusing to seed a production database (set SEED_FORCE=true to override)')
  }

  if (options.reset) {
    await Promise.all([
      ActivityLog.deleteMany({}),
      Attachment.deleteMany({}),
      Comment.deleteMany({}),
      Invitation.deleteMany({}),
      Membership.deleteMany({}),
      Notification.deleteMany({}),
      Project.deleteMany({}),
      Session.deleteMany({}),
      Task.deleteMany({}),
      User.deleteMany({}),
      Workspace.deleteMany({}),
    ])
    logger.info('seed: existing collections cleared')
  }

  const existingUsers = await User.countDocuments({})
  if (existingUsers > 0) {
    logger.info('seed: database already contains users — skipping (set SEED_RESET=true to force)')
    return
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD)
  const userDocs = await User.insertMany(
    PEOPLE.map((person) => ({
      name: person.name,
      email: person.email,
      passwordHash,
      preferences: { theme: 'dark', emailNotifications: true, inAppNotifications: true },
    })),
  )
  const userByEmail = new Map(userDocs.map((user, index) => [PEOPLE[index]!.email, user] as const))
  const userFor = (email: string) => {
    const user = userByEmail.get(email)
    if (!user) throw new Error(`Seed user missing: ${email}`)
    return user
  }

  const now = Date.now()

  const acme = await Workspace.create({
    name: 'Acme Corp',
    slug: 'acme',
    ownerId: userFor('aarav.mehta@flowforge.dev')._id,
    settings: { allowMemberInvites: true },
  })
  const nebula = await Workspace.create({
    name: 'Nebula Labs',
    slug: 'nebula',
    ownerId: userFor('sara.khan@flowforge.dev')._id,
    settings: { allowMemberInvites: false },
  })

  const acmeRoles: Array<[string, Role]> = [
    ['aarav.mehta@flowforge.dev', 'owner'],
    ['priya.sharma@flowforge.dev', 'admin'],
    ['rohan.gupta@flowforge.dev', 'member'],
    ['neha.verma@flowforge.dev', 'member'],
    ['arjun.rao@flowforge.dev', 'viewer'],
    ['divya.nair@flowforge.dev', 'member'],
  ]
  const nebulaRoles: Array<[string, Role]> = [
    ['sara.khan@flowforge.dev', 'owner'],
    ['kabir.singh@flowforge.dev', 'admin'],
    ['priya.sharma@flowforge.dev', 'member'],
    ['aarav.mehta@flowforge.dev', 'viewer'],
  ]

  await Membership.insertMany([
    ...acmeRoles.map(([email, role]) => ({
      workspaceId: acme._id,
      userId: userFor(email)._id,
      role,
    })),
    ...nebulaRoles.map(([email, role]) => ({
      workspaceId: nebula._id,
      userId: userFor(email)._id,
      role,
    })),
  ])

  const projectSpecs = [
    {
      workspace: acme,
      name: 'Website Redesign',
      key: 'WEB',
      description: 'Marketing site redesign and CMS migration.',
    },
    {
      workspace: acme,
      name: 'Mobile App',
      key: 'MOB',
      description: 'React Native companion app for on-the-go updates.',
    },
    {
      workspace: acme,
      name: 'Platform API',
      key: 'PLT',
      description: 'Public API, webhooks and integrations.',
    },
    {
      workspace: nebula,
      name: 'Data Pipeline',
      key: 'DPL',
      description: 'Streaming ingestion and warehouse sync.',
    },
  ]

  const projects = await Project.insertMany(
    projectSpecs.map((spec) => ({
      workspaceId: spec.workspace._id,
      name: spec.name,
      key: spec.key,
      description: spec.description,
      status: 'active',
      createdById: spec.workspace.ownerId,
      taskSeq: 0,
    })),
  )

  const membersByWorkspace = new Map<string, string[]>([
    [String(acme._id), acmeRoles.map(([email]) => String(userFor(email)._id))],
    [String(nebula._id), nebulaRoles.map(([email]) => String(userFor(email)._id))],
  ])

  const taskDocs: Array<Record<string, unknown>> = []
  const activityDocs: Array<Record<string, unknown>> = []
  let templateIndex = 0
  const scale = Math.max(1, options.scale ?? 1)

  for (const project of projects) {
    const memberIds = membersByWorkspace.get(String(project.workspaceId)) ?? []
    let seq = 0
    for (let i = 0; i < 12 * scale; i += 1) {
      const template = TASK_TEMPLATES[templateIndex % TASK_TEMPLATES.length]!
      templateIndex += 1
      seq += 1
      const status = TASK_STATUSES[(i + seq) % TASK_STATUSES.length]!
      const assigneeCount = i % 3 === 0 ? 2 : 1
      const assignees = Array.from(
        { length: assigneeCount },
        (_, k) => memberIds[(i + k + 1) % memberIds.length]!,
      ).map((id) => id)
      const createdAt = new Date(now - (templateIndex % 21) * DAY_MS)
      const dueOffsetDays = (i % 15) - 5
      const completedAt = status === 'done' ? new Date(now - (i % 5) * DAY_MS) : null

      taskDocs.push({
        workspaceId: project.workspaceId,
        projectId: project._id,
        key: `${project.key}-${seq}`,
        title: template.title,
        description: `${template.title}.\n\nAcceptance criteria documented in the project wiki.`,
        status,
        priority: template.priority,
        assigneeIds: assignees,
        reporterId: memberIds[i % memberIds.length]!,
        labels: template.labels,
        dueDate: new Date(now + dueOffsetDays * DAY_MS),
        startDate: new Date(createdAt.getTime() - DAY_MS),
        parentTaskId: null,
        position: i - 12,
        version: 0,
        completedAt,
        createdAt,
        updatedAt: new Date(now - (i % 4) * DAY_MS),
      })

      activityDocs.push({
        workspaceId: project.workspaceId,
        actorId: memberIds[i % memberIds.length]!,
        action: 'task.created',
        entityType: 'task',
        entityId: project._id,
        projectId: project._id,
        metadata: { key: `${project.key}-${seq}`, title: template.title },
        createdAt,
      })
    }
    await Project.updateOne({ _id: project._id }, { $set: { taskSeq: seq } })
  }

  const tasks = await Task.insertMany(taskDocs)
  await ActivityLog.insertMany(activityDocs)

  // Subtasks for the first two tasks of every project
  const subtaskDocs: Array<Record<string, unknown>> = []
  for (const project of projects) {
    const parents = tasks
      .filter((task) => String(task.projectId) === String(project._id))
      .slice(0, 2)
    parents.forEach((parent, index) => {
      subtaskDocs.push({
        workspaceId: parent.workspaceId,
        projectId: parent.projectId,
        key: `${parent.key}-S${index + 1}`,
        title: index === 0 ? 'Write implementation notes' : 'Add regression test',
        description: 'Subtask created by the demo seed.',
        status: index === 0 ? 'done' : 'todo',
        priority: 'medium',
        assigneeIds: [parent.reporterId],
        reporterId: parent.reporterId,
        labels: [],
        dueDate: parent.dueDate,
        startDate: null,
        parentTaskId: parent._id,
        position: index,
        version: 0,
        completedAt: index === 0 ? new Date(now - DAY_MS) : null,
        createdAt: new Date(now - 2 * DAY_MS),
        updatedAt: new Date(now - DAY_MS),
      })
    })
  }
  await Task.insertMany(subtaskDocs)

  const firstTasks = tasks.slice(0, 6)
  await Comment.insertMany(
    firstTasks.map((task, index) => ({
      workspaceId: task.workspaceId,
      taskId: task._id,
      authorId: task.reporterId,
      content:
        index % 2 === 0
          ? 'Kicked this off — initial pass is behind the flag, please review when you have a moment.'
          : 'Updated the estimate after standup. Should be straightforward but worth a second pair of eyes.',
      createdAt: new Date(now - (index + 1) * 3_600_000),
      editedAt: null,
    })),
  )

  await ActivityLog.insertMany([
    {
      workspaceId: acme._id,
      actorId: acme.ownerId,
      action: 'workspace.created',
      entityType: 'workspace',
      entityId: acme._id,
      metadata: { name: acme.name },
      createdAt: new Date(now - 30 * DAY_MS),
    },
    {
      workspaceId: acme._id,
      actorId: userFor('priya.sharma@flowforge.dev')._id,
      action: 'member.joined',
      entityType: 'member',
      entityId: userFor('rohan.gupta@flowforge.dev')._id,
      metadata: { role: 'member', via: 'invitation' },
      createdAt: new Date(now - 12 * DAY_MS),
    },
    {
      workspaceId: nebula._id,
      actorId: nebula.ownerId,
      action: 'project.created',
      entityType: 'project',
      entityId: projects.find((project) => project.key === 'DPL')!._id,
      metadata: { name: 'Data Pipeline', key: 'DPL' },
      createdAt: new Date(now - 9 * DAY_MS),
    },
  ])

  await Notification.insertMany(
    firstTasks.slice(0, 3).map((task) => ({
      workspaceId: task.workspaceId,
      userId: userFor('aarav.mehta@flowforge.dev')._id,
      actorId: task.reporterId,
      type: 'task_assigned',
      title: `You were assigned ${task.key}`,
      body: task.title,
      link: `/acme/tasks/${String(task._id)}`,
      entityId: task._id,
    })),
  )

  logger.info(
    {
      users: userDocs.length,
      workspaces: 2,
      projects: projects.length,
      tasks: tasks.length + subtaskDocs.length,
      password: DEMO_PASSWORD,
    },
    'seed: demo dataset created',
  )
}

const isDirectRun = process.argv[1]?.includes('seed')
if (isDirectRun) {
  connectDatabase()
    .then(() => seedDatabase({ reset: env.SEED_RESET }))
    .then(() => disconnectDatabase())
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error({ err: error }, 'seed failed')
      process.exit(1)
    })
}
