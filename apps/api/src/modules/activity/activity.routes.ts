import { Router } from 'express'
import { z } from 'zod'
import { objectIdSchema } from '@flowforge/shared'
import { asyncHandler } from '../../lib/asyncHandler'
import { requireAuth } from '../../middleware/auth'
import { validate } from '../../middleware/validate'
import { getCtx, requireWorkspace } from '../../middleware/workspace'
import { listActivity } from './activity.service'

const activityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
  projectId: objectIdSchema.optional(),
  taskId: objectIdSchema.optional(),
  actorId: objectIdSchema.optional(),
})

export const activityRoutes = Router({ mergeParams: true })
activityRoutes.use(requireAuth)

activityRoutes.get(
  '/',
  requireWorkspace,
  validate({ query: activityQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json(
      await listActivity(
        getCtx(req),
        req.query as unknown as z.infer<typeof activityQuerySchema>,
      ),
    )
  }),
)
