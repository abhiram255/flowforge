import { Router } from 'express'
import { z } from 'zod'
import {
  createInvitationSchema,
  createWorkspaceSchema,
  objectIdSchema,
  updateMemberSchema,
  updateWorkspaceSchema,
} from '@flowforge/shared'
import { asyncHandler } from '../../lib/asyncHandler'
import { requireAuth } from '../../middleware/auth'
import { requireRole } from '../../middleware/rbac'
import { validate } from '../../middleware/validate'
import { getCtx, requireWorkspace } from '../../middleware/workspace'
import {
  acceptInvitation,
  createInvitation,
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  leaveWorkspace,
  listInvitations,
  listMembers,
  listWorkspaces,
  previewInvitation,
  removeMember,
  revokeInvitation,
  updateMemberRole,
  updateWorkspace,
} from './workspaces.service'

const memberParamsSchema = z.object({
  workspaceId: z.string().min(1),
  userId: objectIdSchema,
})

const invitationParamsSchema = z.object({
  workspaceId: z.string().min(1),
  invitationId: objectIdSchema,
})

export const workspacesRoutes = Router()
workspacesRoutes.use(requireAuth)

workspacesRoutes.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ data: await listWorkspaces(req.auth!.userId) })
  }),
)

workspacesRoutes.post(
  '/',
  validate({ body: createWorkspaceSchema }),
  asyncHandler(async (req, res) => {
    const workspace = await createWorkspace(req.auth!.userId, req.body)
    res.status(201).json({ workspace })
  }),
)

workspacesRoutes.get(
  '/:workspaceId',
  requireWorkspace,
  asyncHandler(async (req, res) => {
    res.json({ workspace: await getWorkspace(getCtx(req)) })
  }),
)

workspacesRoutes.patch(
  '/:workspaceId',
  requireWorkspace,
  validate({ body: updateWorkspaceSchema }),
  asyncHandler(async (req, res) => {
    res.json({ workspace: await updateWorkspace(getCtx(req), req.body) })
  }),
)

workspacesRoutes.delete(
  '/:workspaceId',
  requireWorkspace,
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    await deleteWorkspace(getCtx(req))
    res.status(204).end()
  }),
)

workspacesRoutes.post(
  '/:workspaceId/leave',
  requireWorkspace,
  asyncHandler(async (req, res) => {
    await leaveWorkspace(getCtx(req))
    res.status(204).end()
  }),
)

// Members -------------------------------------------------------------------

workspacesRoutes.get(
  '/:workspaceId/members',
  requireWorkspace,
  asyncHandler(async (req, res) => {
    res.json({ data: await listMembers(getCtx(req)) })
  }),
)

workspacesRoutes.patch(
  '/:workspaceId/members/:userId',
  requireWorkspace,
  requireRole('admin'),
  validate({ params: memberParamsSchema, body: updateMemberSchema }),
  asyncHandler(async (req, res) => {
    const member = await updateMemberRole(getCtx(req), req.params.userId, req.body.role)
    res.json({ member })
  }),
)

workspacesRoutes.delete(
  '/:workspaceId/members/:userId',
  requireWorkspace,
  requireRole('admin'),
  validate({ params: memberParamsSchema }),
  asyncHandler(async (req, res) => {
    await removeMember(getCtx(req), req.params.userId)
    res.status(204).end()
  }),
)

// Invitations ---------------------------------------------------------------

workspacesRoutes.get(
  '/:workspaceId/invitations',
  requireWorkspace,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    res.json({ data: await listInvitations(getCtx(req)) })
  }),
)

workspacesRoutes.post(
  '/:workspaceId/invitations',
  requireWorkspace,
  validate({ body: createInvitationSchema }),
  asyncHandler(async (req, res) => {
    const invitation = await createInvitation(getCtx(req), req.body)
    res.status(201).json({ invitation })
  }),
)

workspacesRoutes.delete(
  '/:workspaceId/invitations/:invitationId',
  requireWorkspace,
  requireRole('admin'),
  validate({ params: invitationParamsSchema }),
  asyncHandler(async (req, res) => {
    await revokeInvitation(getCtx(req), req.params.invitationId)
    res.status(204).end()
  }),
)

// Public invitation routes --------------------------------------------------

export const invitationsRoutes = Router()

invitationsRoutes.get(
  '/:token',
  asyncHandler(async (req, res) => {
    res.json({ invitation: await previewInvitation(req.params.token as string) })
  }),
)

invitationsRoutes.post(
  '/:token/accept',
  requireAuth,
  asyncHandler(async (req, res) => {
    const workspace = await acceptInvitation(req.params.token as string, req.auth!.userId)
    res.json({ workspace })
  }),
)
