import { Schema, model, type Types } from 'mongoose'

export interface WorkspaceSettings {
  allowMemberInvites: boolean
}

export interface WorkspaceDoc {
  _id: Types.ObjectId
  name: string
  slug: string
  ownerId: Types.ObjectId
  settings: WorkspaceSettings
  createdAt: Date
  updatedAt: Date
}

const workspaceSchema = new Schema<WorkspaceDoc>(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    settings: {
      allowMemberInvites: { type: Boolean, default: true },
    },
  },
  { timestamps: true, versionKey: false },
)

export const Workspace = model<WorkspaceDoc>('Workspace', workspaceSchema)
