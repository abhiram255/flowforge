import type { Request, RequestHandler } from 'express'
import { Types } from 'mongoose'
import { ERROR_CODES } from '@flowforge/shared'
import { AppError } from '../lib/errors'
import { asyncHandler } from '../lib/asyncHandler'
import { cache, cacheKeys } from '../lib/cache'
import { isObjectId } from '../lib/utils'
import type { WorkspaceContext } from '../lib/context'
import { Membership, type MembershipDoc } from '../models/Membership'
import { Comment } from '../models/Comment'
import { Project, type ProjectDoc } from '../models/Project'
import { Task } from '../models/Task'
import { Workspace, type WorkspaceDoc } from '../models/Workspace'

/**
 * The access cache stores JSON, so identifiers and dates come back as strings.
 * Revive them to the shapes the rest of the codebase (and Mongoose casts) expect.
 */
const reviveWorkspace = (raw: WorkspaceDoc): WorkspaceDoc => ({
  ...raw,
  _id: new Types.ObjectId(String(raw._id)),
  ownerId: new Types.ObjectId(String(raw.ownerId)),
  createdAt: new Date(raw.createdAt),
  updatedAt: new Date(raw.updatedAt),
})

const reviveMembership = (raw: MembershipDoc): MembershipDoc => ({
  ...raw,
  _id: new Types.ObjectId(String(raw._id)),
  workspaceId: new Types.ObjectId(String(raw.workspaceId)),
  userId: new Types.ObjectId(String(raw.userId)),
  joinedAt: new Date(raw.joinedAt),
  createdAt: new Date(raw.createdAt),
  updatedAt: new Date(raw.updatedAt),
})

/** Workspace documents change rarely; 30s of bounded staleness is invalidated on writes. */
const WORKSPACE_TTL_SECONDS = 30
/** Role changes take effect within 15s at worst, and immediately via invalidation. */
const MEMBERSHIP_TTL_SECONDS = 15

async function resolveWorkspace(ref: string): Promise<WorkspaceDoc> {
  const key = cacheKeys.workspaceByRef(ref.toLowerCase())
  const workspace = await cache.wrap<WorkspaceDoc | null>(key, WORKSPACE_TTL_SECONDS, async () => {
    const found = isObjectId(ref)
      ? await Workspace.findById(ref).lean<WorkspaceDoc>()
      : await Workspace.findOne({ slug: ref.toLowerCase() }).lean<WorkspaceDoc>()
    return found ?? null
  })
  if (!workspace) throw AppError.notFound('Workspace not found', ERROR_CODES.WORKSPACE_NOT_FOUND)
  return reviveWorkspace(workspace)
}

/**
 * Resolves a workspace (id or slug) plus the caller's membership.
 * Non-members get 404 — never 403 — so tenants cannot probe foreign ids.
 */
export async function loadWorkspaceContext(userId: string, ref: string): Promise<WorkspaceContext> {
  const workspace = await resolveWorkspace(ref)
  const membership = await cache.wrap<MembershipDoc | null>(
    cacheKeys.membership(String(workspace._id), userId),
    MEMBERSHIP_TTL_SECONDS,
    async () => Membership.findOne({ workspaceId: workspace._id, userId }).lean<MembershipDoc>(),
  )
  if (!membership) throw AppError.notFound('Workspace not found', ERROR_CODES.WORKSPACE_NOT_FOUND)
  return {
    workspace,
    membership: reviveMembership(membership),
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
