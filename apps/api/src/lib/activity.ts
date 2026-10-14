import type { Types } from 'mongoose'
import { cache } from './cache'
import { logger } from '../config/logger'
import { ActivityLog } from '../models/ActivityLog'
import { emitToWorkspace } from '../realtime/io'

export interface RecordActivityInput {
  action: string
  entityType: 'workspace' | 'project' | 'task' | 'comment' | 'attachment' | 'member' | 'invitation'
  entityId: Types.ObjectId | string
  projectId?: Types.ObjectId | null
  taskId?: Types.ObjectId | null
  metadata?: Record<string, unknown>
}

/**
 * Appends to the workspace activity log and pings connected clients.
 * Failure here must never fail the business operation that triggered it.
 */
export async function recordActivity(
  workspaceId: Types.ObjectId | string,
  actorId: Types.ObjectId | string | null,
  input: RecordActivityInput,
): Promise<void> {
  try {
    await ActivityLog.create({
      workspaceId,
      actorId: actorId ? actorId : null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      projectId: input.projectId ?? null,
      taskId: input.taskId ?? null,
      metadata: input.metadata ?? {},
    })
    emitToWorkspace(String(workspaceId), 'activity:created', {
      action: input.action,
      entityId: String(input.entityId),
    })
  } catch (error) {
    logger.warn({ err: (error as Error).message, action: input.action }, 'failed to record activity')
  }
}

/** Busts the workspace's cached snapshots after writes. */
export async function invalidateWorkspaceCaches(workspaceId: Types.ObjectId | string): Promise<void> {
  const id = String(workspaceId)
  await Promise.all([
    cache.delPrefix(`ff:analytics:${id}:`),
    cache.delPrefix(`ff:dashboard:${id}:`),
    cache.delPrefix(`ff:usersmini:${id}`),
  ])
}
