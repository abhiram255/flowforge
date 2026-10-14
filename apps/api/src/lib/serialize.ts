import type {
  ActivityDTO,
  AttachmentDTO,
  CommentDTO,
  InvitationDTO,
  MemberDTO,
  NotificationDTO,
  ProjectDTO,
  Role,
  SessionDTO,
  TaskDTO,
  TaskStatus,
  UserDTO,
  UserMiniDTO,
  WorkspaceDTO,
} from '@flowforge/shared'
import type { Types } from 'mongoose'
import type { ActivityLogDoc } from '../models/ActivityLog'
import type { AttachmentDoc } from '../models/Attachment'
import type { CommentDoc } from '../models/Comment'
import type { InvitationDoc } from '../models/Invitation'
import type { MembershipDoc } from '../models/Membership'
import type { NotificationDoc } from '../models/Notification'
import type { ProjectDoc } from '../models/Project'
import type { SessionDoc } from '../models/Session'
import type { TaskDoc } from '../models/Task'
import type { UserDoc } from '../models/User'
import type { WorkspaceDoc } from '../models/Workspace'

type IdLike = Types.ObjectId | string
type UserMiniSource = Pick<UserDoc, 'name' | 'avatarUrl'> & { _id: IdLike }

const id = (value: IdLike): string => String(value)
const iso = (value: Date | null | undefined): string | null =>
  value ? new Date(value).toISOString() : null
const isoRequired = (value: Date | null | undefined): string =>
  iso(value) ?? new Date(0).toISOString()

export const toUserMini = (user: UserMiniSource): UserMiniDTO => ({
  id: id(user._id),
  name: user.name,
  avatarUrl: user.avatarUrl ?? null,
})

export const toUserDTO = (user: UserDoc): UserDTO => ({
  id: id(user._id),
  name: user.name,
  email: user.email,
  avatarUrl: user.avatarUrl ?? null,
  preferences: {
    theme: user.preferences?.theme ?? 'dark',
    emailNotifications: user.preferences?.emailNotifications ?? true,
    inAppNotifications: user.preferences?.inAppNotifications ?? true,
  },
  createdAt: isoRequired(user.createdAt),
})

export const toMemberDTO = (
  membership: MembershipDoc,
  user: Pick<UserDoc, 'name' | 'email' | 'avatarUrl'> & { _id: IdLike },
): MemberDTO => ({
  userId: id(user._id),
  name: user.name,
  email: user.email,
  avatarUrl: user.avatarUrl ?? null,
  role: membership.role,
  joinedAt: isoRequired(membership.joinedAt ?? membership.createdAt),
})

export const toWorkspaceDTO = (
  workspace: WorkspaceDoc,
  role: Role,
  stats: { memberCount: number; projectCount: number },
): WorkspaceDTO => ({
  id: id(workspace._id),
  name: workspace.name,
  slug: workspace.slug,
  ownerId: id(workspace.ownerId),
  role,
  settings: { allowMemberInvites: workspace.settings?.allowMemberInvites ?? true },
  memberCount: stats.memberCount,
  projectCount: stats.projectCount,
  createdAt: isoRequired(workspace.createdAt),
})

export const toInvitationDTO = (
  invitation: InvitationDoc,
  extras?: { invitedBy?: UserMiniSource | null; inviteUrl?: string },
): InvitationDTO => ({
  id: id(invitation._id),
  workspaceId: id(invitation.workspaceId),
  email: invitation.email,
  role: invitation.role,
  status: invitation.status,
  expiresAt: isoRequired(invitation.expiresAt),
  createdAt: isoRequired(invitation.createdAt),
  ...(extras?.invitedBy ? { invitedBy: toUserMini(extras.invitedBy) } : {}),
  ...(extras?.inviteUrl ? { inviteUrl: extras.inviteUrl } : {}),
})

export const toProjectDTO = (
  project: ProjectDoc,
  taskCounts?: Record<TaskStatus, number> | null,
): ProjectDTO => ({
  id: id(project._id),
  workspaceId: id(project.workspaceId),
  name: project.name,
  key: project.key,
  description: project.description ?? '',
  status: project.status,
  createdById: project.createdById ? id(project.createdById) : null,
  taskCounts: taskCounts ?? null,
  totalTasks: taskCounts ? Object.values(taskCounts).reduce((sum, count) => sum + count, 0) : null,
  createdAt: isoRequired(project.createdAt),
  updatedAt: isoRequired(project.updatedAt),
})

export const toTaskDTO = (
  task: TaskDoc,
  extras?: {
    project?: (Pick<ProjectDoc, 'key' | 'name'> & { _id: IdLike }) | null
    assignees?: UserMiniSource[]
    reporter?: UserMiniSource | null
    subtaskCount?: number
    attachmentCount?: number
    commentCount?: number
    /** List/board views omit the (up to 20k character) description to keep payloads small. */
    includeDescription?: boolean
  },
): TaskDTO => ({
  id: id(task._id),
  workspaceId: id(task.workspaceId),
  projectId: id(task.projectId),
  projectKey: extras?.project?.key ?? '',
  projectName: extras?.project?.name ?? '',
  key: task.key,
  title: task.title,
  ...(extras?.includeDescription === false ? {} : { description: task.description ?? '' }),
  status: task.status,
  priority: task.priority,
  assignees: (extras?.assignees ?? []).map(toUserMini),
  reporter: extras?.reporter ? toUserMini(extras.reporter) : null,
  labels: task.labels ?? [],
  dueDate: iso(task.dueDate),
  startDate: iso(task.startDate),
  parentTaskId: task.parentTaskId ? id(task.parentTaskId) : null,
  ...(extras?.subtaskCount !== undefined ? { subtaskCount: extras.subtaskCount } : {}),
  ...(extras?.attachmentCount !== undefined ? { attachmentCount: extras.attachmentCount } : {}),
  ...(extras?.commentCount !== undefined ? { commentCount: extras.commentCount } : {}),
  position: task.position,
  version: task.version,
  completedAt: iso(task.completedAt),
  createdAt: isoRequired(task.createdAt),
  updatedAt: isoRequired(task.updatedAt),
})

export const toCommentDTO = (comment: CommentDoc, author?: UserMiniSource | null): CommentDTO => ({
  id: id(comment._id),
  taskId: id(comment.taskId),
  author: author ? toUserMini(author) : null,
  content: comment.content,
  editedAt: iso(comment.editedAt),
  createdAt: isoRequired(comment.createdAt),
})

export const toAttachmentDTO = (
  attachment: AttachmentDoc,
  uploader?: UserMiniSource | null,
): AttachmentDTO => ({
  id: id(attachment._id),
  taskId: id(attachment.taskId),
  filename: attachment.filename,
  mimeType: attachment.mimeType,
  size: attachment.size,
  uploader: uploader ? toUserMini(uploader) : null,
  url: `/api/v1/attachments/${id(attachment._id)}/download`,
  createdAt: isoRequired(attachment.createdAt),
})

export const toActivityDTO = (
  activity: ActivityLogDoc,
  actor?: UserMiniSource | null,
): ActivityDTO => ({
  id: id(activity._id),
  actor: actor ? toUserMini(actor) : null,
  action: activity.action,
  entityType: activity.entityType,
  entityId: String(activity.entityId),
  taskId: activity.taskId ? String(activity.taskId) : null,
  projectId: activity.projectId ? String(activity.projectId) : null,
  metadata: (activity.metadata ?? {}) as Record<string, unknown>,
  createdAt: isoRequired(activity.createdAt),
})

export const toNotificationDTO = (
  notification: NotificationDoc,
  actor?: UserMiniSource | null,
): NotificationDTO => ({
  id: id(notification._id),
  workspaceId: id(notification.workspaceId),
  type: notification.type,
  title: notification.title,
  body: notification.body ?? '',
  link: notification.link ?? null,
  actor: actor ? toUserMini(actor) : null,
  readAt: iso(notification.readAt),
  createdAt: isoRequired(notification.createdAt),
})

export const toSessionDTO = (
  session: SessionDoc,
  currentSessionId?: string | null,
): SessionDTO => ({
  id: id(session._id),
  userAgent: session.userAgent ?? null,
  ip: session.ip ?? null,
  current: currentSessionId === id(session._id),
  createdAt: isoRequired(session.createdAt),
  expiresAt: isoRequired(session.expiresAt),
})
