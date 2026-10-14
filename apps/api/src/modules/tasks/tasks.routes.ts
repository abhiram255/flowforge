import { Router } from 'express'
import {
  createTaskSchema,
  objectIdSchema,
  taskListQuerySchema,
  updateTaskSchema,
} from '@flowforge/shared'
import { z } from 'zod'
import { asyncHandler } from '../../lib/asyncHandler'
import { AppError } from '../../lib/errors'
import { requireAuth } from '../../middleware/auth'
import { requireRole } from '../../middleware/rbac'
import { validate } from '../../middleware/validate'
import { getCtx, loadWorkspaceContext, requireProject, requireTask } from '../../middleware/workspace'
import { Project } from '../../models/Project'
import { createTask, deleteTask, getSubtasks, getTask, listTasks, updateTask } from './tasks.service'

const workspaceScopedListSchema = taskListQuerySchema.extend({
  workspaceId: objectIdSchema.optional(),
})

export const tasksRoutes = Router()
tasksRoutes.use(requireAuth)

/**
 * Cross-project task list. Scope comes either from `projectId` (project must
 * belong to a workspace the caller is a member of) or `workspaceId`.
 */
tasksRoutes.get(
  '/',
  validate({ query: workspaceScopedListSchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof workspaceScopedListSchema>
    const userId = req.auth!.userId

    if (query.projectId) {
      const project = await Project.findById(query.projectId).lean()
      if (!project) throw AppError.notFound('Project not found')
      const ctx = await loadWorkspaceContext(userId, String(project.workspaceId))
      ctx.project = project
      res.json(await listTasks(ctx, query))
      return
    }
    if (query.workspaceId) {
      const ctx = await loadWorkspaceContext(userId, query.workspaceId)
      res.json(await listTasks(ctx, query))
      return
    }
    throw AppError.validation('Provide workspaceId or projectId to list tasks')
  }),
)

tasksRoutes.get(
  '/:taskId',
  requireTask,
  asyncHandler(async (req, res) => {
    res.json({ task: await getTask(getCtx(req)) })
  }),
)

tasksRoutes.get(
  '/:taskId/subtasks',
  requireTask,
  asyncHandler(async (req, res) => {
    res.json({ data: await getSubtasks(getCtx(req)) })
  }),
)

tasksRoutes.patch(
  '/:taskId',
  requireTask,
  requireRole('member'),
  validate({ body: updateTaskSchema }),
  asyncHandler(async (req, res) => {
    res.json({ task: await updateTask(getCtx(req), req.body) })
  }),
)

tasksRoutes.delete(
  '/:taskId',
  requireTask,
  requireRole('member'),
  asyncHandler(async (req, res) => {
    await deleteTask(getCtx(req))
    res.status(204).end()
  }),
)

/** Project-scoped task routes — mounted under /projects/:projectId. */
export const projectTasksRoutes = Router({ mergeParams: true })
projectTasksRoutes.use(requireAuth)

projectTasksRoutes.get(
  '/',
  requireProject,
  validate({ query: taskListQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof taskListQuerySchema>
    res.json(await listTasks(getCtx(req), query))
  }),
)

projectTasksRoutes.post(
  '/',
  requireProject,
  requireRole('member'),
  validate({ body: createTaskSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json({ task: await createTask(getCtx(req), req.body) })
  }),
)
