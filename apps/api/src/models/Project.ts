import { Schema, model, type Types } from 'mongoose'
import { PROJECT_STATUSES, type ProjectStatus } from '@flowforge/shared'

export interface ProjectDoc {
  _id: Types.ObjectId
  workspaceId: Types.ObjectId
  name: string
  key: string
  description: string
  status: ProjectStatus
  createdById: Types.ObjectId | null
  /** Monotonic counter backing human-readable task keys (e.g. WEB-42). */
  taskSeq: number
  createdAt: Date
  updatedAt: Date
}

const projectSchema = new Schema<ProjectDoc>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    key: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      match: /^[A-Z]{2,6}$/,
    },
    description: { type: String, default: '', maxlength: 2000 },
    status: { type: String, enum: PROJECT_STATUSES, default: 'active' },
    createdById: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    taskSeq: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false },
)

/** Project keys are unique per workspace, never globally. */
projectSchema.index({ workspaceId: 1, key: 1 }, { unique: true })
projectSchema.index({ workspaceId: 1, status: 1, updatedAt: -1 })

export const Project = model<ProjectDoc>('Project', projectSchema)
