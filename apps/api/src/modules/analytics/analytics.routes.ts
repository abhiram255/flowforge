import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../../lib/asyncHandler'
import { requireAuth } from '../../middleware/auth'
import { validate } from '../../middleware/validate'
import { getCtx, requireWorkspace } from '../../middleware/workspace'
import { getAnalytics, getDashboard } from './analytics.service'

const analyticsQuerySchema = z.object({
  range: z.coerce.number().int().min(7).max(90).default(30),
})

export const analyticsRoutes = Router({ mergeParams: true })
analyticsRoutes.use(requireAuth)

analyticsRoutes.get(
  '/',
  requireWorkspace,
  validate({ query: analyticsQuerySchema }),
  asyncHandler(async (req, res) => {
    const { range } = req.query as unknown as z.infer<typeof analyticsQuerySchema>
    res.json({ analytics: await getAnalytics(getCtx(req), range) })
  }),
)

analyticsRoutes.get(
  '/dashboard',
  requireWorkspace,
  asyncHandler(async (req, res) => {
    res.json({ dashboard: await getDashboard(getCtx(req), req.auth!.userId) })
  }),
)
