import { Schema, model, type Types } from 'mongoose'
import { NOTIFICATION_TYPES, type NotificationType } from '@flowforge/shared'

export interface NotificationDoc {
  _id: Types.ObjectId
  workspaceId: Types.ObjectId
  userId: Types.ObjectId
  actorId: Types.ObjectId | null
  type: NotificationType
  title: string
  body: string
  link: string | null
  entityId: Types.ObjectId | null
  readAt: Date | null
  createdAt: Date
  updatedAt: Date
}

const notificationSchema = new Schema<NotificationDoc>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true, maxlength: 200 },
    body: { type: String, default: '', maxlength: 500 },
    link: { type: String, default: null },
    entityId: { type: Schema.Types.ObjectId, default: null },
    readAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
)

notificationSchema.index({ userId: 1, createdAt: -1, _id: -1 })
notificationSchema.index({ userId: 1, readAt: 1 })

export const Notification = model<NotificationDoc>('Notification', notificationSchema)
