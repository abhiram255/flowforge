import { z } from 'zod'
import { PROJECT_KEY_REGEX, PROJECT_STATUSES } from '../constants'

export const projectKeySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(PROJECT_KEY_REGEX, 'Use 2–6 uppercase letters (e.g. WEB)')

export const createProjectSchema = z.object({
  name: z.string().trim().min(2, 'Project name is too short').max(80),
  key: projectKeySchema,
  description: z.string().trim().max(2000).optional().default(''),
})

export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    description: z.string().trim().max(2000).optional(),
    status: z.enum(PROJECT_STATUSES).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' })

export type CreateProjectInput = z.infer<typeof createProjectSchema>
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>
