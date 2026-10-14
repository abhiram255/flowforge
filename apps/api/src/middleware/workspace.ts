import type { Request, RequestHandler } from 'express'
import { Types } from 'mongoose'
import { ERROR_CODES } from '@flowforge/shared'
import { AppError } from '../lib/errors'
import { asyncHandler } from '../lib/asyncHandler'
import { isObjectId } from '../lib/utils'
import type { WorkspaceContext } from '../lib/context'
import { Membership } from '../models/Membership'
import { Comment } from '../models/Comment'
import { Project, type ProjectDoc } from '../models/Project'
import { Task } from '../models/Task'
import { Workspace, type WorkspaceDoc } from '../models/Workspace'

async function resolveWorkspace(ref: string): Promise<WorkspaceDoc> {
  const workspace = isObjectId(ref)
    ? await Workspace.findById(ref).lean<WorkspaceDoc>()
    : await Workspace.findOne({ slug: ref.toLowerCase() }).lean<WorkspaceDoc>()
  if (!workspace) throw AppError.notFound('Workspace not found', ERROR_CODES.WORKSPACE_NOT_FOUND)
  return workspace
}

/**
 * Resolves a workspace (id or slug) plus the caller's membership.
 * Non-members get 404 — never 403 — so tenants cannot probe foreign ids.
 */
export async function loadWorkspaceContext(userId: string, ref: string): Promise<WorkspaceContext> {
  const workspace = await resolveWorkspace(ref)
  const membership = await Membership.findOne({ workspaceId: workspace._id, userId }).lean()
  if (!membership) throw AppError.notFound('Workspace not found', ERROR_CODES.WORKSPACE_NOT_FOUND)
  return {
    workspace,
    membership,
    role: membership.role,
    project: null,
    task: null,
  }
}

export const requireWorkspace: RequestHandler = asyncHandler(async (req, _res, next) => {
  if (!req.auth) throw AppError.unauthorized()
  req.ctx = await loadWorkspaceContext(req.auth.userId, req.params.workspaceId ?? '')
  next()
})

export const requireProject: RequestHandler = asyncHandler(async (req, _res, next) => {
  if (!req.auth) throw AppError.unauthorized()
  const projectId = req.params.projectId
  if (!projectId || !isObjectId(projectId)) throw AppError.notFound('Project not found')

  const project = await Project.findById(projectId).lean<ProjectDoc>()
  if (!project) throw AppError.notFound('Project not found')

  const ctx = await loadWorkspaceContext(req.auth.userId, String(project.workspaceId))
  ctx.project = project
  req.ctx = ctx
  next()
})

export const requireTask: RequestHandler = asyncHandler(async (req, _res, next) => {
  if (!req.auth) throw AppError.unauthorized()
  const taskId = req.params.taskId
  if (!taskId || !isObjectId(taskId)) throw AppError.notFound('Task not found')

  const task = await Task.findById(taskId).lean()
  if (!task) throw AppError.notFound('Task not found')

  const ctx = await loadWorkspaceContext(req.auth.userId, String(task.workspaceId))
  ctx.task = task
  req.ctx = ctx
  next()
})

export const requireComment: RequestHandler = asyncHandler(async (req, _res, next) => {
  if (!req.auth) throw AppError.unauthorized()
  const commentId = req.params.commentId
  if (!commentId || !isObjectId(commentId)) throw AppError.notFound('Comment not found')

  const comment = await Comment.findById(commentId).select('workspaceId').lean()
  if (!comment) throw AppError.notFound('Comment not found')

  req.ctx = await loadWorkspaceContext(req.auth.userId, String(comment.workspaceId))
  next()
})

export function getCtx(req: Request): WorkspaceContext {
  if (!req.ctx) throw AppError.internal('Workspace context missing')
  return req.ctx
}

export function objectId(value: string): Types.ObjectId {
  return new Types.ObjectId(value)
}
