import { z } from 'zod'
import {
  MAX_BOARD_TASKS,
  MAX_TASK_ASSIGNEES,
  MAX_TASK_LABELS,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from '../constants'
import { objectIdSchema, paginationQuerySchema } from './common'

export const taskStatusSchema = z.enum(TASK_STATUSES)
export const taskPrioritySchema = z.enum(TASK_PRIORITIES)

export const labelSchema = z.string().trim().min(1).max(24)

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().trim().max(20000).optional().default(''),
  status: taskStatusSchema.default('todo'),
  priority: taskPrioritySchema.default('medium'),
  assigneeIds: z.array(objectIdSchema).max(MAX_TASK_ASSIGNEES).default([]),
  labels: z.array(labelSchema).max(MAX_TASK_LABELS).default([]),
  dueDate: z.coerce.date().nullable().optional(),
  startDate: z.coerce.date().nullable().optional(),
  parentTaskId: objectIdSchema.nullable().optional(),
})

export const updateTaskSchema = z
  .object({
    /** Expected version for optimistic concurrency control. */
    version: z.coerce.number().int().min(0),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(20000).optional(),
    status: taskStatusSchema.optional(),
    priority: taskPrioritySchema.optional(),
    assigneeIds: z.array(objectIdSchema).max(MAX_TASK_ASSIGNEES).optional(),
    labels: z.array(labelSchema).max(MAX_TASK_LABELS).optional(),
    dueDate: z.coerce.date().nullable().optional(),
    startDate: z.coerce.date().nullable().optional(),
    /** Fractional ordering inside a Kanban column. */
    position: z.coerce.number().finite().optional(),
  })
  .refine((value) => Object.keys(value).length > 1, { message: 'No fields to update' })

const csv = <T extends z.ZodTypeAny>(schema: T) =>
  z
    .string()
    .optional()
    .transform((value) => (value ? value.split(',').filter(Boolean) : undefined))
    .pipe(z.array(schema).optional())

export const taskListQuerySchema = paginationQuerySchema.extend({
  status: csv(taskStatusSchema),
  priority: csv(taskPrioritySchema),
  assigneeId: objectIdSchema.optional(),
  parentTaskId: objectIdSchema.optional(),
  projectId: objectIdSchema.optional(),
  q: z.string().trim().max(200).optional(),
  dueBefore: z.coerce.date().optional(),
  sort: z.enum(['position', 'createdAt', 'updatedAt', 'dueDate']).default('createdAt'),
})

export type CreateTaskInput = z.infer<typeof createTaskSchema>
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>
export type TaskListQuery = z.infer<typeof taskListQuerySchema>
export type TaskStatusInput = z.infer<typeof taskStatusSchema>
export type TaskPriorityInput = z.infer<typeof taskPrioritySchema>

/** Hard cap for board queries — a Kanban column set is never cursor-paginated. */
export const boardQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_BOARD_TASKS).default(MAX_BOARD_TASKS),
})
