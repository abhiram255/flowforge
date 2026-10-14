import { Schema, model, type Types } from 'mongoose'

export interface AttachmentDoc {
  _id: Types.ObjectId
  workspaceId: Types.ObjectId
  taskId: Types.ObjectId
  uploaderId: Types.ObjectId
  storageKey: string
  filename: string
  mimeType: string
  size: number
  createdAt: Date
  updatedAt: Date
}

const attachmentSchema = new Schema<AttachmentDoc>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true, index: true },
    uploaderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    storageKey: { type: String, required: true, unique: true },
    filename: { type: String, required: true, maxlength: 255 },
    mimeType: { type: String, required: true, maxlength: 255 },
    size: { type: Number, required: true, min: 0 },
  },
  { timestamps: true, versionKey: false },
)

attachmentSchema.index({ taskId: 1, createdAt: -1 })

export const Attachment = model<AttachmentDoc>('Attachment', attachmentSchema)
