import { z } from 'zod'

export const createCommentSchema = z.object({
  content: z.string().trim().min(1, 'Comment cannot be empty').max(5000),
})

export const updateCommentSchema = z.object({
  content: z.string().trim().min(1, 'Comment cannot be empty').max(5000),
})

export type CreateCommentInput = z.infer<typeof createCommentSchema>
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>
