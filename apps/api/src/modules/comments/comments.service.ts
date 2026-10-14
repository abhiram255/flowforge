import type { FilterQuery } from 'mongoose'
import type { CommentDTO, Paginated } from '@flowforge/shared'
import { recordActivity } from '../../lib/activity'
import type { WorkspaceContext } from '../../lib/context'
import { AppError } from '../../lib/errors'
import { clampLimit, cursorFilter, finalizePage, parseCursor } from '../../lib/pagination'
import { hasAtLeast } from '../../lib/permissions'
import { toCommentDTO } from '../../lib/serialize'
import { uniq } from '../../lib/utils'
import { Comment, type CommentDoc } from '../../models/Comment'
import { User } from '../../models/User'
import { emitToWorkspace } from '../../realtime/io'
import { notify } from '../notifications/notifications.service'

async function decorateComments(docs: CommentDoc[]): Promise<CommentDTO[]> {
  if (docs.length === 0) return []
  const authorIds = uniq(docs.map((doc) => String(doc.authorId)))
  const authors = await User.find({ _id: { $in: authorIds } })
    .select('name avatarUrl')
    .lean()
  const authorById = new Map(authors.map((author) => [String(author._id), author]))
  return docs.map((doc) => toCommentDTO(doc, authorById.get(String(doc.authorId)) ?? null))
}

export async function listComments(
  ctx: WorkspaceContext,
  query: { limit?: number; cursor?: string },
): Promise<Paginated<CommentDTO>> {
  if (!ctx.task) throw AppError.internal('Task context missing')
  const limit = clampLimit(query.limit)
  const filter: FilterQuery<CommentDoc> = {
    workspaceId: ctx.workspace._id,
    taskId: ctx.task._id,
    ...cursorFilter(parseCursor(query.cursor)),
  }
  const docs = await Comment.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean<CommentDoc[]>()
  const page = finalizePage(docs, limit)
  return { data: await decorateComments(page.data), nextCursor: page.nextCursor, hasMore: page.hasMore }
}

export async function createComment(ctx: WorkspaceContext, content: string): Promise<CommentDTO> {
  if (!ctx.task) throw AppError.internal('Task context missing')
  const comment = await Comment.create({
    workspaceId: ctx.workspace._id,
    taskId: ctx.task._id,
    authorId: ctx.membership.userId,
    content,
  })

  await recordActivity(ctx.workspace._id, ctx.membership.userId, {
    action: 'comment.created',
    entityType: 'comment',
    entityId: comment._id,
    projectId: ctx.task.projectId,
    taskId: ctx.task._id,
    metadata: { excerpt: content.slice(0, 120) },
  })

  const [dto] = await decorateComments([comment.toObject() as CommentDoc])
  emitToWorkspace(String(ctx.workspace._id), 'comment:created', {
    comment: dto,
    taskId: String(ctx.task._id),
  })

  const actor = await User.findById(ctx.membership.userId).select('name').lean()
  const recipients = uniq([String(ctx.task.reporterId), ...ctx.task.assigneeIds.map(String)])
  await notify({
    workspaceId: ctx.workspace._id,
    actorId: ctx.membership.userId,
    recipientIds: recipients,
    type: 'task_commented',
    title: `${actor?.name ?? 'Someone'} commented on ${ctx.task.key}`,
    body: content.slice(0, 160),
    link: `/${ctx.workspace.slug}/tasks/${String(ctx.task._id)}`,
    entityId: ctx.task._id,
  })

  return dto as CommentDTO
}

export async function updateComment(
  ctx: WorkspaceContext,
  commentId: string,
  content: string,
): Promise<CommentDTO> {
  const comment = await Comment.findOne({ _id: commentId, workspaceId: ctx.workspace._id })
  if (!comment) throw AppError.notFound('Comment not found')

  // Editing someone else's words is never allowed — not even for admins.
  if (String(comment.authorId) !== String(ctx.membership.userId)) {
    throw AppError.forbidden('Only the author can edit this comment')
  }

  comment.content = content
  comment.editedAt = new Date()
  await comment.save()

  const [dto] = await decorateComments([comment.toObject() as CommentDoc])
  emitToWorkspace(String(ctx.workspace._id), 'comment:updated', {
    comment: dto,
    taskId: String(comment.taskId),
  })
  return dto as CommentDTO
}

export async function deleteComment(ctx: WorkspaceContext, commentId: string): Promise<void> {
  const comment = await Comment.findOne({ _id: commentId, workspaceId: ctx.workspace._id })
  if (!comment) throw AppError.notFound('Comment not found')

  const isAuthor = String(comment.authorId) === String(ctx.membership.userId)
  if (!isAuthor && !hasAtLeast(ctx.role, 'admin')) {
    throw AppError.forbidden('Only the author or an admin can delete this comment')
  }

  await Comment.deleteOne({ _id: comment._id })
  await recordActivity(ctx.workspace._id, ctx.membership.userId, {
    action: 'comment.deleted',
    entityType: 'comment',
    entityId: comment._id,
    taskId: comment.taskId,
  })
  emitToWorkspace(String(ctx.workspace._id), 'comment:deleted', {
    commentId: String(comment._id),
    taskId: String(comment.taskId),
  })
}
