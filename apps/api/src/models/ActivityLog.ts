import { Schema, model, type Types } from 'mongoose'

export interface ActivityLogDoc {
  _id: Types.ObjectId
  workspaceId: Types.ObjectId
  actorId: Types.ObjectId | null
  action: string
  entityType: string
  entityId: Types.ObjectId | string
  taskId: Types.ObjectId | null
  projectId: Types.ObjectId | null
  metadata: Record<string, unknown>
  createdAt: Date
}

const activityLogSchema = new Schema<ActivityLogDoc>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    action: { type: String, required: true, index: true },
    entityType: { type: String, required: true },
    entityId: { type: Schema.Types.Mixed, required: true },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', default: null },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
)

/** Workspace feed in reverse-chronological order (cursor pagination). */
activityLogSchema.index({ workspaceId: 1, createdAt: -1, _id: -1 })
/** Per-task and per-project histories. */
activityLogSchema.index({ workspaceId: 1, taskId: 1, createdAt: -1 })
activityLogSchema.index({ workspaceId: 1, projectId: 1, createdAt: -1 })

export const ActivityLog = model<ActivityLogDoc>('ActivityLog', activityLogSchema)
