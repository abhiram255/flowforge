import { z } from 'zod'
import { ASSIGNABLE_ROLES, ROLES, WORKSPACE_SLUG_REGEX } from '../constants'
import { emailSchema } from './auth'

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(WORKSPACE_SLUG_REGEX, 'Use lowercase letters, numbers and dashes')
  .min(3)
  .max(48)

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(2, 'Workspace name is too short').max(80),
  slug: slugSchema.optional(),
})

export const updateWorkspaceSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    slug: slugSchema.optional(),
    settings: z
      .object({
        allowMemberInvites: z.boolean().optional(),
      })
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' })

export const updateMemberSchema = z.object({
  role: z.enum(ROLES),
})

export const createInvitationSchema = z.object({
  email: emailSchema,
  role: z.enum(ASSIGNABLE_ROLES),
})

export const workspaceParamSchema = z.object({ workspaceId: z.string().min(1).max(64) })

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>
