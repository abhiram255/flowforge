import { Router } from 'express'
import { z } from 'zod'
import { createCommentSchema, objectIdSchema, updateCommentSchema } from '@flowforge/shared'
import { asyncHandler } from '../../lib/asyncHandler'
import { requireAuth } from '../../middleware/auth'
import { requireRole } from '../../middleware/rbac'
import { validate } from '../../middleware/validate'
import { getCtx, requireComment, requireTask } from '../../middleware/workspace'
import { createComment, deleteComment, listComments, updateComment } from './comments.service'

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
})

/** Mounted at /tasks/:taskId/comments */
export const taskCommentsRoutes = Router({ mergeParams: true })
taskCommentsRoutes.use(requireAuth)

taskCommentsRoutes.get(
  '/',
  requireTask,
  validate({ query: listQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json(await listComments(getCtx(req), req.query as z.infer<typeof listQuerySchema>))
  }),
)

taskCommentsRoutes.post(
  '/',
  requireTask,
  requireRole('member'),
  validate({ body: createCommentSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json({ comment: await createComment(getCtx(req), req.body.content) })
  }),
)

/** Mounted at /comments */
export const commentsRoutes = Router()
commentsRoutes.use(requireAuth)

commentsRoutes.patch(
  '/:commentId',
  validate({ params: z.object({ commentId: objectIdSchema }), body: updateCommentSchema }),
  requireComment,
  requireRole('member'),
  asyncHandler(async (req, res) => {
    res.json({ comment: await updateComment(getCtx(req), req.params.commentId, req.body.content) })
  }),
)

commentsRoutes.delete(
  '/:commentId',
  validate({ params: z.object({ commentId: objectIdSchema }) }),
  requireComment,
  requireRole('member'),
  asyncHandler(async (req, res) => {
    await deleteComment(getCtx(req), req.params.commentId)
    res.status(204).end()
  }),
)
