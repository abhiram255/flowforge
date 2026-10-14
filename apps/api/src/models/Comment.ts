import { Schema, model, type Types } from 'mongoose'

export interface CommentDoc {
  _id: Types.ObjectId
  workspaceId: Types.ObjectId
  taskId: Types.ObjectId
  authorId: Types.ObjectId
  content: string
  editedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

const commentSchema = new Schema<CommentDoc>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true, index: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, required: true, trim: true, maxlength: 5000 },
    editedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
)

commentSchema.index({ taskId: 1, createdAt: -1, _id: -1 })

export const Comment = model<CommentDoc>('Comment', commentSchema)
