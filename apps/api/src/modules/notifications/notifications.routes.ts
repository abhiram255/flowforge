import { Router } from 'express'
import { z } from 'zod'
import { objectIdSchema } from '@flowforge/shared'
import { asyncHandler } from '../../lib/asyncHandler'
import { requireAuth } from '../../middleware/auth'
import { validate } from '../../middleware/validate'
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  unreadNotificationCount,
} from './notifications.service'

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
  unreadOnly: z.enum(['true', 'false']).optional(),
  workspaceId: objectIdSchema.optional(),
})

export const notificationsRoutes = Router()
notificationsRoutes.use(requireAuth)

notificationsRoutes.get(
  '/',
  validate({ query: listQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof listQuerySchema>
    res.json(
      await listNotifications(req.auth!.userId, {
        limit: query.limit,
        cursor: query.cursor,
        unreadOnly: query.unreadOnly === 'true',
        workspaceId: query.workspaceId,
      }),
    )
  }),
)

notificationsRoutes.get(
  '/unread-count',
  asyncHandler(async (req, res) => {
    res.json({ count: await unreadNotificationCount(req.auth!.userId) })
  }),
)

notificationsRoutes.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined
    res.json({ updated: await markAllNotificationsRead(req.auth!.userId, workspaceId) })
  }),
)

notificationsRoutes.post(
  '/:notificationId/read',
  validate({ params: z.object({ notificationId: objectIdSchema }) }),
  asyncHandler(async (req, res) => {
    await markNotificationRead(req.auth!.userId, req.params.notificationId)
    res.status(204).end()
  }),
)
