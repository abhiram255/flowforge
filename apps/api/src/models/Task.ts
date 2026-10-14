import { Schema, model, type Types } from 'mongoose'
import { TASK_PRIORITIES, TASK_STATUSES, type TaskPriority, type TaskStatus } from '@flowforge/shared'

export interface TaskDoc {
  _id: Types.ObjectId
  workspaceId: Types.ObjectId
  projectId: Types.ObjectId
  key: string
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  assigneeIds: Types.ObjectId[]
  reporterId: Types.ObjectId
  labels: string[]
  dueDate: Date | null
  startDate: Date | null
  parentTaskId: Types.ObjectId | null
  /** Fractional ordering inside a Kanban column. */
  position: number
  /** Optimistic concurrency control version — incremented on every write. */
  version: number
  completedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

const taskSchema = new Schema<TaskDoc>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    key: { type: String, required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: '', maxlength: 20000 },
    status: { type: String, enum: TASK_STATUSES, default: 'todo' },
    priority: { type: String, enum: TASK_PRIORITIES, default: 'medium' },
    assigneeIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    reporterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    labels: [{ type: String, trim: true, maxlength: 24 }],
    dueDate: { type: Date, default: null },
    startDate: { type: Date, default: null },
    parentTaskId: { type: Schema.Types.ObjectId, ref: 'Task', default: null },
    position: { type: Number, default: 0 },
    version: { type: Number, default: 0 },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
)

/** Kanban board reads: one project's column set ordered by position. */
taskSchema.index({ workspaceId: 1, projectId: 1, status: 1, position: 1 })
/** "My tasks / workload" reads across a workspace. */
taskSchema.index({ workspaceId: 1, assigneeIds: 1, status: 1, dueDate: 1 })
/** Subtask lookups. */
taskSchema.index({ workspaceId: 1, parentTaskId: 1, createdAt: -1 })
/** Cursor-paginated feeds. */
taskSchema.index({ workspaceId: 1, createdAt: -1, _id: -1 })
/** Full-text search within a workspace. */
taskSchema.index({ workspaceId: 1, title: 'text', description: 'text' })

export const Task = model<TaskDoc>('Task', taskSchema)
