import { Types, type FilterQuery } from 'mongoose'
import {
  ERROR_CODES,
  MAX_BOARD_TASKS,
  type CreateTaskInput,
  type Paginated,
  type TaskDTO,
  type TaskListQuery,
  type UpdateTaskInput,
} from '@flowforge/shared'
import { getStorageDriver } from '../../config/storage'
import { invalidateWorkspaceCaches, recordActivity } from '../../lib/activity'
import { cache, cacheKeys } from '../../lib/cache'
import type { WorkspaceContext } from '../../lib/context'
import { AppError } from '../../lib/errors'
import { clampLimit, cursorFilter, finalizePage, parseCursor } from '../../lib/pagination'
import { hasAtLeast } from '../../lib/permissions'
import { toTaskDTO } from '../../lib/serialize'
import { uniq } from '../../lib/utils'
import { Attachment } from '../../models/Attachment'
import { Comment } from '../../models/Comment'
import { Membership } from '../../models/Membership'
import { Project, type ProjectDoc } from '../../models/Project'
import { Task, type TaskDoc } from '../../models/Task'
import { User } from '../../models/User'
import { emitToWorkspace } from '../../realtime/io'
import { notify } from '../notifications/notifications.service'

interface DecorateOptions {
  includeCounts?: boolean
  includeDescription?: boolean
  /** Pre-loaded projects (e.g. from requireProject middleware) to skip a query. */
  knownProjects?: Array<Pick<ProjectDoc, 'key' | 'name'> & { _id: Types.ObjectId }>
}

async function countSubtasks(tasks: TaskDoc[]): Promise<Map<string, number>> {
  const rows = await Task.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { parentTaskId: { $in: tasks.map((task) => task._id) } } },
    { $group: { _id: '$parentTaskId', count: { $sum: 1 } } },
  ])
  return new Map(rows.map((row) => [String(row._id), row.count]))
}

async function countComments(tasks: TaskDoc[]): Promise<Map<string, number>> {
  const rows = await Comment.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { taskId: { $in: tasks.map((task) => task._id) } } },
    { $group: { _id: '$taskId', count: { $sum: 1 } } },
  ])
  return new Map(rows.map((row) => [String(row._id), row.count]))
}

async function countAttachments(tasks: TaskDoc[]): Promise<Map<string, number>> {
  const rows = await Attachment.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { taskId: { $in: tasks.map((task) => task._id) } } },
    { $group: { _id: '$taskId', count: { $sum: 1 } } },
  ])
  return new Map(rows.map((row) => [String(row._id), row.count]))
}

/** Batches project/assignee/reporter/count lookups so lists never N+1. */
export async function decorateTasks(
  tasks: TaskDoc[],
  options: DecorateOptions = {},
): Promise<TaskDTO[]> {
  if (tasks.length === 0) return []

  const projectIds = uniq(tasks.map((task) => String(task.projectId)))
  const workspaceId = String(tasks[0]!.workspaceId)

  const [projects, userMinis, subtasks, comments, attachments] = await Promise.all([
    options.knownProjects
      ? Promise.resolve(options.knownProjects)
      : Project.find({ _id: { $in: projectIds } })
          .select('key name')
          .lean(),
    // Workspace member "minis" change rarely — a short cache removes one query
    // from every board render. Bust via invalidateWorkspaceCaches on membership changes.
    cache.wrap(cacheKeys.workspaceUserMinis(workspaceId), 30, async () => {
      const memberships = await Membership.find({ workspaceId }).select('userId').lean()
      const users = await User.find({ _id: { $in: memberships.map((m) => m.userId) } })
        .select('name avatarUrl')
        .lean()
      return users.map((user) => ({
        _id: String(user._id),
        name: user.name,
        avatarUrl: user.avatarUrl ?? null,
      }))
    }),
    options.includeCounts ? countSubtasks(tasks) : Promise.resolve(new Map<string, number>()),
    options.includeCounts ? countComments(tasks) : Promise.resolve(new Map<string, number>()),
    options.includeCounts ? countAttachments(tasks) : Promise.resolve(new Map<string, number>()),
  ])

  const projectById = new Map(projects.map((project) => [String(project._id), project]))
  const userById = new Map(userMinis.map((user) => [String(user._id), user]))

  return tasks.map((task) =>
    toTaskDTO(task, {
      project: projectById.get(String(task.projectId)) ?? null,
      assignees: task.assigneeIds
        .map((assigneeId) => userById.get(String(assigneeId)))
        .filter((user): user is NonNullable<typeof user> => Boolean(user)),
      reporter: userById.get(String(task.reporterId)) ?? null,
      subtaskCount: subtasks.get(String(task._id)),
      commentCount: comments.get(String(task._id)),
      attachmentCount: attachments.get(String(task._id)),
      includeDescription: options.includeDescription,
    }),
  )
}

async function assertAssigneesAreMembers(
  ctx: WorkspaceContext,
  assigneeIds: string[],
): Promise<Types.ObjectId[]> {
  const unique = uniq(assigneeIds.map(String))
  if (unique.length === 0) return []
  const count = await Membership.countDocuments({
    workspaceId: ctx.workspace._id,
    userId: { $in: unique },
  })
  if (count !== unique.length) {
    throw AppError.validation('All assignees must be members of this workspace')
  }
  return unique.map((id) => new Types.ObjectId(id))
}

async function nextTopPosition(
  ctx: WorkspaceContext,
  projectId: Types.ObjectId,
  status: string,
): Promise<number> {
  const first = await Task.findOne({
    workspaceId: ctx.workspace._id,
    projectId,
    status,
  })
    .sort({ position: 1 })
    .select('position')
    .lean()
  return (first?.position ?? 0) - 1
}

export interface TaskListParams extends TaskListQuery {
  projectId?: string
}

export async function listTasks(
  ctx: WorkspaceContext,
  query: TaskListParams,
): Promise<Paginated<TaskDTO>> {
  const filter: FilterQuery<TaskDoc> = { workspaceId: ctx.workspace._id }

  const projectId = query.projectId ?? (ctx.project ? String(ctx.project._id) : undefined)
  if (projectId) filter.projectId = new Types.ObjectId(projectId)
  if (query.status?.length) filter.status = { $in: query.status }
  if (query.priority?.length) filter.priority = { $in: query.priority }
  if (query.assigneeId) filter.assigneeIds = new Types.ObjectId(query.assigneeId)
  if (query.parentTaskId) filter.parentTaskId = new Types.ObjectId(query.parentTaskId)
  else filter.parentTaskId = null
  if (query.q) filter.$text = { $search: query.q }

  const sort = query.sort
  const dueFilter: Record<string, unknown> = {}
  if (query.dueBefore) dueFilter.$lte = query.dueBefore
  if (sort === 'dueDate') dueFilter.$ne = null
  if (Object.keys(dueFilter).length > 0) filter.dueDate = dueFilter

  if (sort === 'createdAt' || sort === 'updatedAt') {
    Object.assign(filter, cursorFilter(parseCursor(query.cursor), sort))
  }

  const sortSpec: Record<string, 1 | -1> =
    sort === 'position'
      ? { position: 1, createdAt: 1 }
      : sort === 'dueDate'
        ? { dueDate: 1, createdAt: 1 }
        : sort === 'updatedAt'
          ? { updatedAt: -1, _id: -1 }
          : { createdAt: -1, _id: -1 }

  if (sort === 'position') {
    // Board reads are bounded snapshots — a Kanban column set is never paged.
    const limit = Math.min(query.limit ?? MAX_BOARD_TASKS, MAX_BOARD_TASKS)
    const docs = await Task.find(filter).sort(sortSpec).limit(limit).lean<TaskDoc[]>()
    return {
      data: await decorateTasks(docs, {
        includeDescription: false,
        ...(ctx.project ? { knownProjects: [ctx.project] } : {}),
      }),
      nextCursor: null,
      hasMore: false,
    }
  }

  const limit = clampLimit(query.limit)
  const docs = await Task.find(filter)
    .sort(sortSpec)
    .limit(limit + 1)
    .lean<TaskDoc[]>()
  const page = finalizePage(docs, limit)
  return {
    data: await decorateTasks(page.data, {
      includeDescription: false,
      ...(ctx.project ? { knownProjects: [ctx.project] } : {}),
    }),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  }
}

export async function getTask(ctx: WorkspaceContext): Promise<TaskDTO> {
  if (!ctx.task) throw AppError.internal('Task context missing')
  const [dto] = await decorateTasks([ctx.task], { includeCounts: true })
  return dto as TaskDTO
}

export async function getSubtasks(ctx: WorkspaceContext): Promise<TaskDTO[]> {
  if (!ctx.task) throw AppError.internal('Task context missing')
  const docs = await Task.find({
    workspaceId: ctx.workspace._id,
    parentTaskId: ctx.task._id,
  })
    .sort({ createdAt: 1 })
    .lean<TaskDoc[]>()
  return decorateTasks(docs, { includeCounts: true })
}

export async function createTask(ctx: WorkspaceContext, input: CreateTaskInput): Promise<TaskDTO> {
  if (!ctx.project) throw AppError.internal('Project context missing')
  const project = ctx.project

  const assigneeIds = await assertAssigneesAreMembers(ctx, input.assigneeIds)

  let parentTaskId: Types.ObjectId | null = null
  if (input.parentTaskId) {
    const parent = await Task.findOne({
      _id: input.parentTaskId,
      workspaceId: ctx.workspace._id,
      projectId: project._id,
    }).lean()
    if (!parent) throw AppError.validation('Parent task not found in this project')
    if (parent.parentTaskId)
      throw AppError.validation('Subtasks cannot be nested more than one level deep')
    parentTaskId = parent._id
  }

  const withSeq = await Project.findOneAndUpdate(
    { _id: project._id, workspaceId: ctx.workspace._id },
    { $inc: { taskSeq: 1 } },
    { new: true },
  ).lean<ProjectDoc>()
  if (!withSeq) throw AppError.notFound('Project not found')

  const position = await nextTopPosition(ctx, project._id, input.status)

  const task = await Task.create({
    workspaceId: ctx.workspace._id,
    projectId: project._id,
    key: `${project.key}-${withSeq.taskSeq}`,
    title: input.title,
    description: input.description ?? '',
    status: input.status,
    priority: input.priority,
    assigneeIds,
    reporterId: ctx.membership.userId,
    labels: input.labels,
    dueDate: input.dueDate ?? null,
    startDate: input.startDate ?? null,
    parentTaskId,
    position,
    completedAt: input.status === 'done' ? new Date() : null,
  })

  await recordActivity(ctx.workspace._id, ctx.membership.userId, {
    action: 'task.created',
    entityType: 'task',
    entityId: task._id,
    projectId: project._id,
    taskId: task._id,
    metadata: { key: task.key, title: task.title, status: task.status },
  })
  await invalidateWorkspaceCaches(ctx.workspace._id)

  const [dto] = await decorateTasks([task.toObject() as TaskDoc], { includeCounts: true })
  emitToWorkspace(String(ctx.workspace._id), 'task:created', { task: dto })

  if (assigneeIds.length > 0) {
    await notify({
      workspaceId: ctx.workspace._id,
      actorId: ctx.membership.userId,
      recipientIds: assigneeIds,
      type: 'task_assigned',
      title: `You were assigned ${task.key}`,
      body: task.title,
      link: `/${ctx.workspace.slug}/tasks/${String(task._id)}`,
      entityId: task._id,
    })
  }

  return dto as TaskDTO
}

export async function updateTask(ctx: WorkspaceContext, input: UpdateTaskInput): Promise<TaskDTO> {
  if (!ctx.task) throw AppError.internal('Task context missing')
  const task = ctx.task
  const set: Record<string, unknown> = {}
  const changed: string[] = []

  for (const field of ['title', 'description', 'status', 'priority', 'labels'] as const) {
    if (input[field] !== undefined) {
      set[field] = input[field]
      changed.push(field)
    }
  }
  if (input.assigneeIds !== undefined) {
    set.assigneeIds = await assertAssigneesAreMembers(ctx, input.assigneeIds)
    changed.push('assigneeIds')
  }
  if (input.dueDate !== undefined) {
    set.dueDate = input.dueDate
    changed.push('dueDate')
  }
  if (input.startDate !== undefined) {
    set.startDate = input.startDate
    changed.push('startDate')
  }
  if (input.position !== undefined) {
    set.position = input.position
    changed.push('position')
  }

  if (changed.length === 0) throw AppError.validation('No fields to update')

  const statusChanged = set.status !== undefined && set.status !== task.status
  if (statusChanged) {
    if (set.status === 'done') set.completedAt = new Date()
    else if (task.status === 'done') set.completedAt = null
  }

  const updated = await Task.findOneAndUpdate(
    { _id: task._id, workspaceId: ctx.workspace._id, version: input.version },
    { $set: set, $inc: { version: 1 } },
    { new: true },
  ).lean<TaskDoc>()

  if (!updated) {
    const latest = await Task.findById(task._id).lean<TaskDoc>()
    if (!latest) throw AppError.notFound('Task not found')
    const [latestDto] = await decorateTasks([latest], { includeCounts: true })
    throw new AppError(
      409,
      ERROR_CODES.VERSION_CONFLICT,
      'This task was changed by someone else — refresh to see the latest version and retry',
      { latestVersion: latest.version, yourVersion: input.version, latest: latestDto },
    )
  }

  await recordActivity(ctx.workspace._id, ctx.membership.userId, {
    action: statusChanged && set.status === 'done' ? 'task.completed' : 'task.updated',
    entityType: 'task',
    entityId: task._id,
    projectId: task.projectId,
    taskId: task._id,
    metadata: {
      fields: changed,
      ...(statusChanged ? { from: task.status, to: set.status } : {}),
    },
  })
  await invalidateWorkspaceCaches(ctx.workspace._id)

  const [dto] = await decorateTasks([updated], { includeCounts: true })
  emitToWorkspace(String(ctx.workspace._id), 'task:updated', { task: dto })

  // Notifications — only when something others care about actually changed.
  const previousAssigneeIds = task.assigneeIds.map(String)
  const addedAssignees =
    input.assigneeIds !== undefined
      ? input.assigneeIds.filter((id) => !previousAssigneeIds.includes(String(id)))
      : []
  const actor = await User.findById(ctx.membership.userId).select('name').lean()

  if (addedAssignees.length > 0) {
    await notify({
      workspaceId: ctx.workspace._id,
      actorId: ctx.membership.userId,
      recipientIds: addedAssignees,
      type: 'task_assigned',
      title: `You were assigned ${updated.key}`,
      body: updated.title,
      link: `/${ctx.workspace.slug}/tasks/${String(updated._id)}`,
      entityId: updated._id,
    })
  }
  if (statusChanged) {
    const watchers = uniq([String(updated.reporterId), ...updated.assigneeIds.map(String)])
    await notify({
      workspaceId: ctx.workspace._id,
      actorId: ctx.membership.userId,
      recipientIds: watchers,
      type: 'task_status_changed',
      title: `${actor?.name ?? 'Someone'} moved ${updated.key} to ${String(set.status).replace('_', ' ')}`,
      body: updated.title,
      link: `/${ctx.workspace.slug}/tasks/${String(updated._id)}`,
      entityId: updated._id,
    })
  }

  return dto as TaskDTO
}

export async function deleteTask(ctx: WorkspaceContext): Promise<void> {
  if (!ctx.task) throw AppError.internal('Task context missing')
  const task = ctx.task

  const canDelete =
    hasAtLeast(ctx.role, 'admin') || String(task.reporterId) === String(ctx.membership.userId)
  if (!canDelete) {
    throw AppError.forbidden('Only the reporter or a workspace admin can delete this task')
  }

  const subtasks = await Task.find({ parentTaskId: task._id }).select('_id').lean()
  const taskIds = [task._id, ...subtasks.map((subtask) => subtask._id)]

  const attachments = await Attachment.find({ taskId: { $in: taskIds } })
    .select('storageKey')
    .lean()
  const driver = getStorageDriver()
  await Promise.all(
    attachments.map((file) => driver.delete(file.storageKey).catch(() => undefined)),
  )

  await Promise.all([
    Attachment.deleteMany({ taskId: { $in: taskIds } }),
    Comment.deleteMany({ taskId: { $in: taskIds } }),
    Task.deleteMany({ _id: { $in: taskIds } }),
  ])

  await recordActivity(ctx.workspace._id, ctx.membership.userId, {
    action: 'task.deleted',
    entityType: 'task',
    entityId: task._id,
    projectId: task.projectId,
    metadata: { key: task.key, title: task.title, subtasks: subtasks.length },
  })
  await invalidateWorkspaceCaches(ctx.workspace._id)

  emitToWorkspace(String(ctx.workspace._id), 'task:deleted', {
    taskId: String(task._id),
    projectId: String(task.projectId),
    parentTaskId: task.parentTaskId ? String(task.parentTaskId) : null,
  })
}
