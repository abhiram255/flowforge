import { Router } from 'express'
import { updatePreferencesSchema, updateProfileSchema } from '@flowforge/shared'
import { asyncHandler } from '../../lib/asyncHandler'
import { AppError } from '../../lib/errors'
import { toUserDTO } from '../../lib/serialize'
import { requireAuth } from '../../middleware/auth'
import { validate } from '../../middleware/validate'
import { User } from '../../models/User'

export const usersRoutes = Router()

usersRoutes.use(requireAuth)

usersRoutes.get(
  '/me',
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.auth!.userId).lean()
    if (!user) throw AppError.notFound('User not found')
    res.json({ user: toUserDTO(user) })
  }),
)

usersRoutes.patch(
  '/me',
  validate({ body: updateProfileSchema }),
  asyncHandler(async (req, res) => {
    const user = await User.findByIdAndUpdate(
      req.auth!.userId,
      { $set: req.body },
      { new: true, runValidators: true },
    ).lean()
    if (!user) throw AppError.notFound('User not found')
    res.json({ user: toUserDTO(user) })
  }),
)

usersRoutes.patch(
  '/me/preferences',
  validate({ body: updatePreferencesSchema }),
  asyncHandler(async (req, res) => {
    const set: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(req.body)) {
      set[`preferences.${key}`] = value
    }
    const user = await User.findByIdAndUpdate(
      req.auth!.userId,
      { $set: set },
      { new: true, runValidators: true },
    ).lean()
    if (!user) throw AppError.notFound('User not found')
    res.json({ user: toUserDTO(user) })
  }),
)
