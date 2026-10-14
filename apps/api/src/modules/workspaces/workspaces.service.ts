import { randomBytes, randomUUID } from 'node:crypto'
import { Types } from 'mongoose'
import {
  ERROR_CODES,
  ROLE_RANK,
  type CreateInvitationInput,
  type CreateWorkspaceInput,
  type InvitationDTO,
  type MemberDTO,
  type Role,
  type UpdateWorkspaceInput,
  type WorkspaceDTO,
} from '@flowforge/shared'
import { env } from '../../config/env'
import { invalidateWorkspaceCaches, recordActivity } from '../../lib/activity'
import type { WorkspaceContext } from '../../lib/context'
import { AppError } from '../../lib/errors'
import { hasAtLeast } from '../../lib/permissions'
import { toInvitationDTO, toMemberDTO, toWorkspaceDTO } from '../../lib/serialize'
import { sha256Hex } from '../../lib/tokens'
import { slugify, uniq } from '../../lib/utils'
import { enqueue } from '../../jobs/queue'
import { Attachment } from '../../models/Attachment'
import { ActivityLog } from '../../models/ActivityLog'
import { Comment } from '../../models/Comment'
import { Invitation } from '../../models/Invitation'
import { Membership } from '../../models/Membership'
import { Notification } from '../../models/Notification'
import { Project } from '../../models/Project'
import { Task } from '../../models/Task'
import { User } from '../../models/User'
import { Workspace, type WorkspaceDoc } from '../../models/Workspace'
import { getStorageDriver } from '../../config/storage'
import { notify } from '../notifications/notifications.service'

async function workspaceStats(workspaceId: Types.ObjectId): Promise<{ memberCount: number; projectCount: number }> {
  const [memberCount, projectCount] = await Promise.all([
    Membership.countDocuments({ workspaceId }),
    Project.countDocuments({ workspaceId, status: 'active' }),
  ])
  return { memberCount, projectCount }
}

export async function listWorkspaces(userId: string): Promise<WorkspaceDTO[]> {
  const memberships = await Membership.find({ userId }).lean()
  if (memberships.length === 0) return []
  const workspaceIds = memberships.map((membership) => membership.workspaceId)

  const [workspaces, memberCounts, projectCounts] = await Promise.all([
    Workspace.find({ _id: { $in: workspaceIds } }).sort({ createdAt: 1 }).lean<WorkspaceDoc[]>(),
    Membership.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { workspaceId: { $in: workspaceIds } } },
      { $group: { _id: '$workspaceId', count: { $sum: 1 } } },
    ]),
    Project.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { workspaceId: { $in: workspaceIds }, status: 'active' } },
      { $group: { _id: '$workspaceId', count: { $sum: 1 } } },
    ]),
  ])

  const roleByWorkspace = new Map(memberships.map((m) => [String(m.workspaceId), m.role]))
  const memberCountByWorkspace = new Map(memberCounts.map((row) => [String(row._id), row.count]))
  const projectCountByWorkspace = new Map(projectCounts.map((row) => [String(row._id), row.count]))

  return workspaces.map((workspace) =>
    toWorkspaceDTO(workspace, roleByWorkspace.get(String(workspace._id)) ?? 'viewer', {
      memberCount: memberCountByWorkspace.get(String(workspace._id)) ?? 0,
      projectCount: projectCountByWorkspace.get(String(workspace._id)) ?? 0,
    }),
  )
}

export async function createWorkspace(userId: string, input: CreateWorkspaceInput): Promise<WorkspaceDTO> {
  const name = input.name.trim()
  let slug = input.slug ?? slugify(name) ?? ''
  if (!slug) slug = `ws-${randomUUID().slice(0, 8)}`

  const taken = await Workspace.findOne({ slug }).select('_id').lean()
  if (taken) {
    if (input.slug) throw AppError.conflict('That workspace URL is already taken', ERROR_CODES.DUPLICATE)
    slug = `${slug}-${randomBytes(2).toString('hex')}`
  }

  const workspace = await Workspace.create({ name, slug, ownerId: userId })
  await Membership.create({ workspaceId: workspace._id, userId, role: 'owner' })
  await recordActivity(workspace._id, userId, {
    action: 'workspace.created',
    entityType: 'workspace',
    entityId: workspace._id,
    metadata: { name },
  })
  return toWorkspaceDTO(workspace.toObject() as WorkspaceDoc, 'owner', {
    memberCount: 1,
    projectCount: 0,
  })
}

export async function getWorkspace(ctx: WorkspaceContext): Promise<WorkspaceDTO> {
  const stats = await workspaceStats(ctx.workspace._id)
  return toWorkspaceDTO(ctx.workspace, ctx.role, stats)
}

export async function updateWorkspace(
  ctx: WorkspaceContext,
  input: UpdateWorkspaceInput,
): Promise<WorkspaceDTO> {
  if (!hasAtLeast(ctx.role, 'admin')) {
    // A member may only flip personal-preference style settings if exposed; for now all settings are admin-level.
    throw AppError.forbidden('Only workspace admins can update workspace settings')
  }

  const set: Record<string, unknown> = {}
  if (input.name !== undefined) set.name = input.name
  if (input.slug !== undefined && input.slug !== ctx.workspace.slug) {
    const taken = await Workspace.findOne({ slug: input.slug, _id: { $ne: ctx.workspace._id } })
      .select('_id')
      .lean()
    if (taken) throw AppError.conflict('That workspace URL is already taken', ERROR_CODES.DUPLICATE)
    set.slug = input.slug
  }
  if (input.settings?.allowMemberInvites !== undefined) {
    set['settings.allowMemberInvites'] = input.settings.allowMemberInvites
  }

  const updated = await Workspace.findByIdAndUpdate(
    ctx.workspace._id,
    { $set: set },
    { new: true, runValidators: true },
  ).lean<WorkspaceDoc>()
  if (!updated) throw AppError.notFound('Workspace not found')

  await recordActivity(ctx.workspace._id, ctx.membership.userId, {
    action: 'workspace.updated',
    entityType: 'workspace',
    entityId: ctx.workspace._id,
    metadata: { fields: Object.keys(set) },
  })
  const stats = await workspaceStats(ctx.workspace._id)
  return toWorkspaceDTO(updated, ctx.role, stats)
}

/** Owner-only. Cascades every workspace-owned document and stored file. */
export async function deleteWorkspace(ctx: WorkspaceContext): Promise<void> {
  if (ctx.role !== 'owner') throw AppError.forbidden('Only the workspace owner can delete it')
  const workspaceId = ctx.workspace._id

  const attachments = await Attachment.find({ workspaceId }).select('storageKey').lean()
  const driver = getStorageDriver()
  await Promise.all(attachments.map((file) => driver.delete(file.storageKey).catch(() => undefined)))

  await Promise.all([
    Attachment.deleteMany({ workspaceId }),
    Comment.deleteMany({ workspaceId }),
    Task.deleteMany({ workspaceId }),
    Project.deleteMany({ workspaceId }),
    Invitation.deleteMany({ workspaceId }),
    Membership.deleteMany({ workspaceId }),
    ActivityLog.deleteMany({ workspaceId }),
    Notification.deleteMany({ workspaceId }),
  ])
  await Workspace.deleteOne({ _id: workspaceId })
  await invalidateWorkspaceCaches(workspaceId)
}

export async function leaveWorkspace(ctx: WorkspaceContext): Promise<void> {
  if (ctx.role === 'owner') {
    throw AppError.conflict(
      'Transfer ownership or delete the workspace before leaving it',
      ERROR_CODES.LAST_OWNER,
    )
  }
  const userId = ctx.membership.userId
  await Membership.deleteOne({ _id: ctx.membership._id })
  await Task.updateMany(
    { workspaceId: ctx.workspace._id, assigneeIds: userId },
    { $pull: { assigneeIds: userId }, $inc: { version: 1 } },
  )
  await recordActivity(ctx.workspace._id, userId, {
    action: 'member.left',
    entityType: 'member',
    entityId: userId,
  })
  await invalidateWorkspaceCaches(ctx.workspace._id)
}

export async function listMembers(ctx: WorkspaceContext): Promise<MemberDTO[]> {
  const memberships = await Membership.find({ workspaceId: ctx.workspace._id }).lean()
  const users = await User.find({ _id: { $in: memberships.map((m) => m.userId) } })
    .select('name email avatarUrl')
    .lean()
  const userById = new Map(users.map((user) => [String(user._id), user]))

  return memberships
    .map((membership) => {
      const user = userById.get(String(membership.userId))
      return user ? toMemberDTO(membership, user) : null
    })
    .filter((member): member is MemberDTO => member !== null)
    .sort(
      (a, b) =>
        ROLE_RANK[b.role] - ROLE_RANK[a.role] || a.name.localeCompare(b.name),
    )
}

export async function updateMemberRole(
  ctx: WorkspaceContext,
  targetUserId: string,
  role: Role,
): Promise<MemberDTO> {
  const target = await Membership.findOne({ workspaceId: ctx.workspace._id, userId: targetUserId })
  if (!target) throw AppError.notFound('Member not found')

  if (String(target.userId) === String(ctx.membership.userId)) {
    throw AppError.validation('You cannot change your own role')
  }

  if (role === 'owner') {
    if (ctx.role !== 'owner') throw AppError.forbidden('Only the owner can transfer ownership')
    await Workspace.updateOne({ _id: ctx.workspace._id }, { $set: { ownerId: target.userId } })
    await Membership.updateOne({ _id: target._id }, { $set: { role: 'owner' } })
    await Membership.updateOne({ _id: ctx.membership._id }, { $set: { role: 'admin' } })
    await recordActivity(ctx.workspace._id, ctx.membership.userId, {
      action: 'member.role_changed',
      entityType: 'member',
      entityId: target.userId,
      metadata: { from: target.role, to: 'owner', ownershipTransferred: true },
    })
    await notify({
      workspaceId: ctx.workspace._id,
      actorId: ctx.membership.userId,
      recipientIds: [target.userId],
      type: 'member_joined',
      title: `You are now the owner of ${ctx.workspace.name}`,
      body: 'Ownership was transferred to you.',
      link: `/${ctx.workspace.slug}/settings`,
    })
    return reloadMember(ctx.workspace._id, target.userId)
  }

  if (!hasAtLeast(ctx.role, 'admin')) {
    throw AppError.forbidden('Only workspace admins can change roles')
  }
  if (target.role === 'owner') {
    throw AppError.forbidden('The owner role cannot be changed — transfer ownership instead')
  }

  await Membership.updateOne({ _id: target._id }, { $set: { role } })
  await recordActivity(ctx.workspace._id, ctx.membership.userId, {
    action: 'member.role_changed',
    entityType: 'member',
    entityId: target.userId,
    metadata: { from: target.role, to: role },
  })
  await invalidateWorkspaceCaches(ctx.workspace._id)
  return reloadMember(ctx.workspace._id, target.userId)
}

async function reloadMember(
  workspaceId: Types.ObjectId,
  userId: Types.ObjectId | string,
): Promise<MemberDTO> {
  const membership = await Membership.findOne({ workspaceId, userId }).lean()
  const user = await User.findById(userId).select('name email avatarUrl').lean()
  if (!membership || !user) throw AppError.notFound('Member not found')
  return toMemberDTO(membership, user)
}

export async function removeMember(ctx: WorkspaceContext, targetUserId: string): Promise<void> {
  if (String(targetUserId) === String(ctx.membership.userId)) {
    return leaveWorkspace(ctx)
  }
  const target = await Membership.findOne({ workspaceId: ctx.workspace._id, userId: targetUserId })
  if (!target) throw AppError.notFound('Member not found')
  if (target.role === 'owner') throw AppError.forbidden('The workspace owner cannot be removed')

  await Membership.deleteOne({ _id: target._id })
  await Task.updateMany(
    { workspaceId: ctx.workspace._id, assigneeIds: targetUserId },
    { $pull: { assigneeIds: new Types.ObjectId(targetUserId) }, $inc: { version: 1 } },
  )
  await recordActivity(ctx.workspace._id, ctx.membership.userId, {
    action: 'member.removed',
    entityType: 'member',
    entityId: targetUserId,
  })
  await notify({
    workspaceId: ctx.workspace._id,
    actorId: ctx.membership.userId,
    recipientIds: [targetUserId],
    type: 'member_joined',
    title: `You were removed from ${ctx.workspace.name}`,
    body: 'An admin removed your access to this workspace.',
  })
  await invalidateWorkspaceCaches(ctx.workspace._id)
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

export async function createInvitation(
  ctx: WorkspaceContext,
  input: CreateInvitationInput,
): Promise<InvitationDTO> {
  const privileged = hasAtLeast(ctx.role, 'admin')
  if (!privileged) {
    if (!hasAtLeast(ctx.role, 'member')) throw AppError.forbidden('Viewers cannot invite members')
    if (!(ctx.workspace.settings?.allowMemberInvites ?? true)) {
      throw AppError.forbidden('Invitations are restricted to admins in this workspace')
    }
    if (input.role !== 'member') {
      throw AppError.forbidden('Only admins can invite with elevated roles')
    }
  }

  const existingUser = await User.findOne({ email: input.email }).select('_id').lean()
  if (existingUser) {
    const alreadyMember = await Membership.findOne({
      workspaceId: ctx.workspace._id,
      userId: existingUser._id,
    })
      .select('_id')
      .lean()
    if (alreadyMember) {
      throw AppError.conflict('That person is already a member of this workspace', ERROR_CODES.ALREADY_MEMBER)
    }
  }

  /** Re-inviting supersedes an earlier pending invitation. */
  await Invitation.deleteMany({ workspaceId: ctx.workspace._id, email: input.email, status: 'pending' })

  const rawToken = randomBytes(32).toString('base64url')
  const invitation = await Invitation.create({
    workspaceId: ctx.workspace._id,
    email: input.email,
    role: input.role,
    invitedById: ctx.membership.userId,
    tokenHash: sha256Hex(rawToken),
  })

  const inviteUrl = `${env.APP_URL}/invite/${rawToken}`
  await enqueue('send-email', {
    to: input.email,
    subject: `You're invited to ${ctx.workspace.name} on FlowForge`,
    text: [
      `You have been invited to join the "${ctx.workspace.name}" workspace as ${input.role}.`,
      '',
      `Accept the invitation: ${inviteUrl}`,
      '',
      `This link expires in 7 days.`,
    ].join('\n'),
  })
  await recordActivity(ctx.workspace._id, ctx.membership.userId, {
    action: 'invitation.created',
    entityType: 'invitation',
    entityId: invitation._id,
    metadata: { email: input.email, role: input.role },
  })

  const inviter = await User.findById(ctx.membership.userId).select('name avatarUrl').lean()
  return toInvitationDTO(invitation.toObject(), { invitedBy: inviter, inviteUrl })
}

export async function listInvitations(ctx: WorkspaceContext): Promise<InvitationDTO[]> {
  const invitations = await Invitation.find({ workspaceId: ctx.workspace._id, status: 'pending' })
    .sort({ createdAt: -1 })
    .lean()
  const inviterIds = uniq(invitations.map((invitation) => String(invitation.invitedById)))
  const inviters = await User.find({ _id: { $in: inviterIds } })
    .select('name avatarUrl')
    .lean()
  const inviterById = new Map(inviters.map((user) => [String(user._id), user]))

  return invitations.map((invitation) =>
    toInvitationDTO(invitation, {
      invitedBy: inviterById.get(String(invitation.invitedById)) ?? null,
    }),
  )
}

export async function revokeInvitation(ctx: WorkspaceContext, invitationId: string): Promise<void> {
  const result = await Invitation.findOneAndUpdate(
    { _id: invitationId, workspaceId: ctx.workspace._id, status: 'pending' },
    { $set: { status: 'revoked' } },
  )
  if (!result) throw AppError.notFound('Invitation not found')
  await recordActivity(ctx.workspace._id, ctx.membership.userId, {
    action: 'invitation.revoked',
    entityType: 'invitation',
    entityId: invitationId,
    metadata: { email: result.email },
  })
}

export interface InvitationPreview {
  workspaceName: string
  workspaceSlug: string
  email: string
  role: Role
  expiresAt: string
  invitedBy: string | null
}

export async function previewInvitation(token: string): Promise<InvitationPreview> {
  const invitation = await Invitation.findOne({ tokenHash: sha256Hex(token), status: 'pending' }).lean()
  if (!invitation) {
    throw AppError.notFound('Invitation not found or already used', ERROR_CODES.INVITATION_INVALID)
  }
  if (invitation.expiresAt < new Date()) {
    throw new AppError(400, ERROR_CODES.INVITATION_EXPIRED, 'This invitation has expired')
  }
  const [workspace, inviter] = await Promise.all([
    Workspace.findById(invitation.workspaceId).select('name slug').lean<WorkspaceDoc>(),
    User.findById(invitation.invitedById).select('name').lean(),
  ])
  if (!workspace) throw AppError.notFound('Workspace no longer exists', ERROR_CODES.INVITATION_INVALID)

  return {
    workspaceName: workspace.name,
    workspaceSlug: workspace.slug,
    email: invitation.email,
    role: invitation.role,
    expiresAt: invitation.expiresAt.toISOString(),
    invitedBy: inviter?.name ?? null,
  }
}

export async function acceptInvitation(token: string, userId: string): Promise<WorkspaceDTO> {
  const invitation = await Invitation.findOne({ tokenHash: sha256Hex(token), status: 'pending' })
  if (!invitation) {
    throw AppError.notFound('Invitation not found or already used', ERROR_CODES.INVITATION_INVALID)
  }
  if (invitation.expiresAt < new Date()) {
    throw new AppError(400, ERROR_CODES.INVITATION_EXPIRED, 'This invitation has expired')
  }

  const user = await User.findById(userId).select('email name').lean()
  if (!user) throw AppError.unauthorized()
  if (user.email !== invitation.email) {
    throw new AppError(
      403,
      ERROR_CODES.EMAIL_MISMATCH,
      `This invitation was issued to ${invitation.email}. Sign in with that account to accept it.`,
    )
  }

  const workspace = await Workspace.findById(invitation.workspaceId).lean<WorkspaceDoc>()
  if (!workspace) throw AppError.notFound('Workspace no longer exists', ERROR_CODES.INVITATION_INVALID)

  const existing = await Membership.findOne({ workspaceId: workspace._id, userId })
  if (existing) {
    throw AppError.conflict('You are already a member of this workspace', ERROR_CODES.ALREADY_MEMBER)
  }

  await Membership.create({
    workspaceId: workspace._id,
    userId,
    role: invitation.role,
    joinedAt: new Date(),
  })
  invitation.status = 'accepted'
  await invitation.save()

  await recordActivity(workspace._id, userId, {
    action: 'member.joined',
    entityType: 'member',
    entityId: userId,
    metadata: { role: invitation.role, via: 'invitation' },
  })
  await notify({
    workspaceId: workspace._id,
    actorId: userId,
    recipientIds: [invitation.invitedById],
    type: 'invitation_accepted',
    title: `${user.name} joined ${workspace.name}`,
    body: `Invitation accepted as ${invitation.role}.`,
    link: `/${workspace.slug}/team`,
    entityId: userId,
  })
  await invalidateWorkspaceCaches(workspace._id)

  const stats = await workspaceStats(workspace._id)
  return toWorkspaceDTO(workspace, invitation.role, stats)
}
