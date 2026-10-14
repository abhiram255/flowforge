import type { Role } from '@flowforge/shared'
import type { MembershipDoc } from '../models/Membership'
import type { ProjectDoc } from '../models/Project'
import type { TaskDoc } from '../models/Task'
import type { WorkspaceDoc } from '../models/Workspace'

export interface AuthContext {
  userId: string
  sessionId: string
}

/**
 * Request-scoped tenancy context. Every workspace-owned query in a service
 * must be filtered by `ctx.workspace._id` — this is what makes tenant
 * isolation enforced instead of hoped for.
 */
export interface WorkspaceContext {
  workspace: WorkspaceDoc
  membership: MembershipDoc
  role: Role
  project: ProjectDoc | null
  task: TaskDoc | null
}
