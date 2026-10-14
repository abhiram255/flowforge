import { Router } from 'express'
import { z } from 'zod'
import { createProjectSchema, updateProjectSchema } from '@flowforge/shared'
import { asyncHandler } from '../../lib/asyncHandler'
import { requireAuth } from '../../middleware/auth'
import { requireRole } from '../../middleware/rbac'
import { validate } from '../../middleware/validate'
import { getCtx, requireProject, requireWorkspace } from '../../middleware/workspace'
import { createProject, deleteProject, getProject, listProjects, updateProject } from './projects.service'

const includeArchivedQuery = z.object({ includeArchived: z.coerce.boolean().optional() })

export const workspacesProjectsRoutes = Router({ mergeParams: true })
workspacesProjectsRoutes.use(requireAuth)

workspacesProjectsRoutes.get(
  '/',
  requireWorkspace,
  asyncHandler(async (req, res) => {
    res.json({
      data: await listProjects(getCtx(req), { includeArchived: req.query.includeArchived === 'true' }),
    })
  }),
)

workspacesProjectsRoutes.post(
  '/',
  requireWorkspace,
  requireRole('member'),
  validate({ body: createProjectSchema }),
  asyncHandler(async (req, res) => {
    const project = await createProject(getCtx(req), req.body)
    res.status(201).json({ project })
  }),
)

export const projectsRoutes = Router()
projectsRoutes.use(requireAuth)

projectsRoutes.get(
  '/:projectId',
  requireProject,
  asyncHandler(async (req, res) => {
    res.json({ project: await getProject(getCtx(req)) })
  }),
)

projectsRoutes.patch(
  '/:projectId',
  requireProject,
  requireRole('member'),
  validate({ body: updateProjectSchema }),
  asyncHandler(async (req, res) => {
    res.json({ project: await updateProject(getCtx(req), req.body) })
  }),
)

projectsRoutes.delete(
  '/:projectId',
  requireProject,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    await deleteProject(getCtx(req))
    res.status(204).end()
  }),
)

export { includeArchivedQuery }
