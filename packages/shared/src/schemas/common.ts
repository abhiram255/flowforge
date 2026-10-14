import { z } from 'zod'
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, OBJECT_ID_REGEX, WORKSPACE_SLUG_REGEX } from '../constants'

export const objectIdSchema = z.string().regex(OBJECT_ID_REGEX, 'Invalid id')

/**
 * Workspace routes accept either the workspace id or its human-friendly slug,
 * so URLs stay readable (`/workspaces/acme/analytics`).
 */
export const workspaceRefSchema = z.union([
  objectIdSchema,
  z
    .string()
    .trim()
    .toLowerCase()
    .regex(WORKSPACE_SLUG_REGEX, 'Invalid workspace reference')
    .min(3)
    .max(48),
])

export const cursorSchema = z.string().min(1).max(512)

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  cursor: cursorSchema.optional(),
})

export type PaginationQuery = z.infer<typeof paginationQuerySchema>

export const idParamSchema = z.object({ id: objectIdSchema })
