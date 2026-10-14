export const ROLES = ['owner', 'admin', 'member', 'viewer'] as const
export type Role = (typeof ROLES)[number]

/** Roles that can be handed out through invitations / role changes. */
export const ASSIGNABLE_ROLES = ['admin', 'member', 'viewer'] as const
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number]

export const ROLE_RANK: Record<Role, number> = {
  viewer: 1,
  member: 2,
  admin: 3,
  owner: 4,
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
}

/** Ordered Kanban columns. */
export const TASK_STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
}

export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

export const PRIORITY_RANK: Record<TaskPriority, number> = {
  low: 0,
  medium: 1,
  high: 2,
  urgent: 3,
}

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
}

export const PROJECT_STATUSES = ['active', 'archived'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export const INVITATION_STATUSES = ['pending', 'accepted', 'revoked'] as const
export type InvitationStatus = (typeof INVITATION_STATUSES)[number]

export const NOTIFICATION_TYPES = [
  'task_assigned',
  'task_commented',
  'task_status_changed',
  'task_due_soon',
  'member_joined',
  'invitation_accepted',
] as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

export const THEMES = ['light', 'dark', 'system'] as const
export type Theme = (typeof THEMES)[number]

export const PROJECT_KEY_REGEX = /^[A-Z]{2,6}$/
export const WORKSPACE_SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const OBJECT_ID_REGEX = /^[0-9a-f]{24}$/i

export const DEFAULT_PAGE_SIZE = 25
export const MAX_PAGE_SIZE = 100
export const INVITATION_TTL_DAYS = 7
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const MAX_TASK_ASSIGNEES = 10
export const MAX_TASK_LABELS = 10
export const MAX_BOARD_TASKS = 500

/** Actions recorded in the workspace activity log. */
export const ERROR_CODES = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  TOKEN_INVALID: 'TOKEN_INVALID',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  REFRESH_REUSE_DETECTED: 'REFRESH_REUSE_DETECTED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  WORKSPACE_NOT_FOUND: 'WORKSPACE_NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  CONFLICT: 'CONFLICT',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  DUPLICATE: 'DUPLICATE',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_FILE_TYPE: 'UNSUPPORTED_FILE_TYPE',
  INVALID_CURSOR: 'INVALID_CURSOR',
  LAST_OWNER: 'LAST_OWNER',
  ALREADY_MEMBER: 'ALREADY_MEMBER',
  INVITATION_INVALID: 'INVITATION_INVALID',
  INVITATION_EXPIRED: 'INVITATION_EXPIRED',
  EMAIL_MISMATCH: 'EMAIL_MISMATCH',
  STORAGE_ERROR: 'STORAGE_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]

export const REPORTABLE_ERROR_CODES: readonly string[] = Object.values(ERROR_CODES)
