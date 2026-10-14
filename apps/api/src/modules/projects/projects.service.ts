import type { Types } from 'mongoose'
import {
  ERROR_CODES,
  TASK_STATUSES,
  type CreateProjectInput,
  type ProjectDTO,
  type TaskStatus,
  type UpdateProjectInput,
} from '@flowforge/shared'
import { invalidateWorkspaceCaches, recordActivity } from '../../lib/activity'
import type { WorkspaceContext } from '../../lib/context'
import { AppError } from '../../lib/errors'
import { hasAtLeast } from '../../lib/permissions'
import { toProjectDTO } from '../../lib/serialize'
import { getStorageDriver } from '../../config/storage'
import { Attachment } from '../../models/Attachment'
import { Comment } from '../../models/Comment'
import { Project, type ProjectDoc } from '../../models/Project'
import { Task } from '../../models/Task'
import { emitToWorkspace } from '../../realtime/io'

const emptyCounts = (): Record<TaskStatus, number> =>
  Object.fromEntries(TASK_STATUSES.map((status) => [status, 0])) as Record<TaskStatus, number>

async function taskCountsFor(
  workspaceId: Types.ObjectId,
  projectIds: Types.ObjectId[],
): Promise<Map<string, Record<TaskStatus, number>>> {
  if (projectIds.length === 0) return new Map()
  const rows = await Task.aggregate<{
    _id: { projectId: Types.ObjectId; status: TaskStatus }
    count: number
  }>([
    { $match: { workspaceId, projectId: { $in: projectIds } } },
    { $group: { _id: { projectId: '$projectId', status: '$status' }, count: { $sum: 1 } } },
  ])

  const map = new Map<string, Record<TaskStatus, number>>()
  for (const row of rows) {
    const key = String(row._id.projectId)
    const counts = map.get(key) ?? emptyCounts()
    counts[row._id.status] = row.count
    map.set(key, counts)
  }
  return map
}

export async function listProjects(
  ctx: WorkspaceContext,
  options: { includeArchived?: boolean } = {},
): Promise<ProjectDTO[]> {
  const filter: Record<string, unknown> = { workspaceId: ctx.workspace._id }
  if (!options.includeArchived) filter.status = { $ne: 'archived' }

  const projects = await Project.find(filter).sort({ updatedAt: -1 }).lean<ProjectDoc[]>()
  const counts = await taskCountsFor(
    ctx.workspace._id,
    projects.map((project) => project._id),
  )
  return projects.map((project) => toProjectDTO(project, counts.get(String(project._id)) ?? emptyCounts()))
}

export async function getProject(ctx: WorkspaceContext): Promise<ProjectDTO> {
  if (!ctx.project) throw AppError.internal('Project context missing')
  const counts = await taskCountsFor(ctx.workspace._id, [ctx.project._id])
  return toProjectDTO(ctx.project, counts.get(String(ctx.project._id)) ?? emptyCounts())
}

export async function createProject(
  ctx: WorkspaceContext,
  input: CreateProjectInput,
): Promise<ProjectDTO> {
  const existing = await Project.findOne({ workspaceId: ctx.workspace._id, key: input.key })
    .select('_id')
    .lean()
  if (existing) {
    throw AppError.conflict(`Project key "${input.key}" is already in use in this workspace`, ERROR_CODES.DUPLICATE)
  }

  const project = await Project.create({
    workspaceId: ctx.workspace._id,
    name: input.name,
    key: input.key,
    description: input.description ?? '',
    createdById: ctx.membership.userId,
  })

  await recordActivity(ctx.workspace._id, ctx.membership.userId, {
    action: 'project.created',
    entityType: 'project',
    entityId: project._id,
    projectId: project._id,
    metadata: { name: project.name, key: project.key },
  })
  await invalidateWorkspaceCaches(ctx.workspace._id)

  const dto = toProjectDTO(project.toObject() as ProjectDoc, emptyCounts())
  emitToWorkspace(String(ctx.workspace._id), 'project:created', { project: dto })
  return dto
}

export async function updateProject(
  ctx: WorkspaceContext,
  input: UpdateProjectInput,
): Promise<ProjectDTO> {
  if (!ctx.project) throw AppError.internal('Project context missing')

  if (input.status !== undefined && input.status !== ctx.project.status) {
    if (!hasAtLeast(ctx.role, 'admin')) {
      throw AppError.forbidden('Only workspace admins can archive or restore projects')
    }
  }

  const set: Record<string, unknown> = {}
  if (input.name !== undefined) set.name = input.name
  if (input.description !== undefined) set.description = input.description
  if (input.status !== undefined) set.status = input.status

  const updated = await Project.findByIdAndUpdate(ctx.project._id, { $set: set }, { new: true })
    .lean<ProjectDoc>()
  if (!updated) throw AppError.notFound('Project not found')

  await recordActivity(ctx.workspace._id, ctx.membership.userId, {
    action: input.status === 'archived' ? 'project.archived' : 'project.updated',
    entityType: 'project',
    entityId: ctx.project._id,
    projectId: ctx.project._id,
    metadata: { fields: Object.keys(set) },
  })
  await invalidateWorkspaceCaches(ctx.workspace._id)

  const counts = await taskCountsFor(ctx.workspace._id, [ctx.project._id])
  const dto = toProjectDTO(updated, counts.get(String(ctx.project._id)) ?? emptyCounts())
  emitToWorkspace(String(ctx.workspace._id), 'project:updated', { project: dto })
  return dto
}

/** Admin-only. Cascades tasks, comments, attachments and their stored files. */
export async function deleteProject(ctx: WorkspaceContext): Promise<void> {
  if (!ctx.project) throw AppError.internal('Project context missing')
  if (!hasAtLeast(ctx.role, 'admin')) {
    throw AppError.forbidden('Only workspace admins can delete projects')
  }

  const tasks = await Task.find({ workspaceId: ctx.workspace._id, projectId: ctx.project._id })
    .select('_id')
    .lean()
  const taskIds = tasks.map((task) => task._id)

  const attachments = await Attachment.find({ taskId: { $in: taskIds } })
    .select('storageKey')
    .lean()
  const driver = getStorageDriver()
  await Promise.all(attachments.map((file) => driver.delete(file.storageKey).catch(() => undefined)))

  await Promise.all([
    Attachment.deleteMany({ taskId: { $in: taskIds } }),
    Comment.deleteMany({ taskId: { $in: taskIds } }),
    Task.deleteMany({ _id: { $in: taskIds } }),
  ])
  await Project.deleteOne({ _id: ctx.project._id })

  await recordActivity(ctx.workspace._id, ctx.membership.userId, {
    action: 'project.deleted',
    entityType: 'project',
    entityId: ctx.project._id,
    metadata: { name: ctx.project.name, key: ctx.project.key },
  })
  await invalidateWorkspaceCaches(ctx.workspace._id)
  emitToWorkspace(String(ctx.workspace._id), 'project:deleted', {
    projectId: String(ctx.project._id),
  })
}
