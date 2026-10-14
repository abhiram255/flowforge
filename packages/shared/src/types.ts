import type {
  InvitationStatus,
  NotificationType,
  ProjectStatus,
  Role,
  TaskPriority,
  TaskStatus,
  Theme,
} from './constants'

export interface UserPreferences {
  theme: Theme
  emailNotifications: boolean
  inAppNotifications: boolean
}

export interface UserDTO {
  id: string
  name: string
  email: string
  avatarUrl: string | null
  preferences: UserPreferences
  createdAt: string
}

export interface UserMiniDTO {
  id: string
  name: string
  avatarUrl: string | null
}

export interface WorkspaceDTO {
  id: string
  name: string
  slug: string
  ownerId: string
  role: Role
  settings: {
    allowMemberInvites: boolean
  }
  memberCount: number
  projectCount: number
  createdAt: string
}

export interface MemberDTO {
  userId: string
  name: string
  email: string
  avatarUrl: string | null
  role: Role
  joinedAt: string
}

export interface InvitationDTO {
  id: string
  workspaceId: string
  email: string
  role: Role
  status: InvitationStatus
  expiresAt: string
  createdAt: string
  invitedBy?: UserMiniDTO
  /** Present for workspace admins so they can share the link (dev/demo friendly). */
  inviteUrl?: string
}

export interface ProjectDTO {
  id: string
  workspaceId: string
  name: string
  key: string
  description: string
  status: ProjectStatus
  createdById: string | null
  taskCounts: Record<TaskStatus, number> | null
  totalTasks: number | null
  createdAt: string
  updatedAt: string
}

export interface TaskDTO {
  id: string
  workspaceId: string
  projectId: string
  projectKey: string
  projectName: string
  key: string
  title: string
  /** Omitted from list/board payloads — always present on the task detail endpoint. */
  description?: string
  status: TaskStatus
  priority: TaskPriority
  assignees: UserMiniDTO[]
  reporter: UserMiniDTO | null
  labels: string[]
  dueDate: string | null
  startDate: string | null
  parentTaskId: string | null
  subtaskCount?: number
  attachmentCount?: number
  commentCount?: number
  position: number
  version: number
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CommentDTO {
  id: string
  taskId: string
  author: UserMiniDTO | null
  content: string
  editedAt: string | null
  createdAt: string
}

export interface AttachmentDTO {
  id: string
  taskId: string
  filename: string
  mimeType: string
  size: number
  uploader: UserMiniDTO | null
  url: string
  createdAt: string
}

export interface ActivityDTO {
  id: string
  actor: UserMiniDTO | null
  action: string
  entityType: string
  entityId: string
  taskId: string | null
  projectId: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

export interface NotificationDTO {
  id: string
  workspaceId: string
  type: NotificationType
  title: string
  body: string
  link: string | null
  actor: UserMiniDTO | null
  readAt: string | null
  createdAt: string
}

export interface SessionDTO {
  id: string
  userAgent: string | null
  ip: string | null
  current: boolean
  createdAt: string
  expiresAt: string
}

export interface AuthTokensDTO {
  accessToken: string
  expiresIn: number
}

export interface AuthResponseDTO {
  user: UserDTO
  accessToken: string
}

export interface Paginated<T> {
  data: T[]
  nextCursor: string | null
  hasMore: boolean
}

export interface ApiErrorBody {
  error: {
    code: string
    message: string
    details?: unknown
    requestId?: string
  }
}

export interface AnalyticsOverview {
  totalTasks: number
  openTasks: number
  completedTasks: number
  overdueTasks: number
  completionRate: number
  avgCycleTimeHours: number | null
  completedLast30d: number
  completedPrev30d: number
}

export interface CompletionPoint {
  date: string
  completed: number
  created: number
}

export interface WorkloadEntry {
  userId: string
  name: string
  avatarUrl: string | null
  open: number
  overdue: number
}

export interface StatusSlice {
  status: TaskStatus
  count: number
}

export interface AnalyticsDTO {
  overview: AnalyticsOverview
  completionTrend: CompletionPoint[]
  workload: WorkloadEntry[]
  statusDistribution: StatusSlice[]
  projects: Array<{ id: string; name: string; key: string; total: number; done: number }>
  generatedAt: string
}

export interface DashboardDTO {
  myOpenTasks: number
  myOverdueTasks: number
  myCompletedThisWeek: number
  projectCount: number
  memberCount: number
  assignedTasks: TaskDTO[]
  upcomingDeadlines: TaskDTO[]
  recentActivity: ActivityDTO[]
  workload: WorkloadEntry[]
}

export interface HealthDTO {
  status: 'ok' | 'degraded'
  uptimeSeconds: number
  db: 'connected' | 'disconnected'
  cache: 'redis' | 'memory'
  queues: 'redis' | 'inline'
  version: string
}
