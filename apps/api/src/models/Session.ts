import { Schema, model, type Types } from 'mongoose'

export interface SessionDoc {
  _id: Types.ObjectId
  userId: Types.ObjectId
  /** Groups rotated refresh tokens so token-theft reuse can revoke the whole family. */
  familyId: string
  refreshTokenHash: string
  userAgent: string | null
  ip: string | null
  revokedAt: Date | null
  replacedBy: Types.ObjectId | null
  lastUsedAt: Date
  expiresAt: Date
  createdAt: Date
  updatedAt: Date
}

const sessionSchema = new Schema<SessionDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    familyId: { type: String, required: true, index: true },
    refreshTokenHash: { type: String, required: true, unique: true },
    userAgent: { type: String, default: null, maxlength: 512 },
    ip: { type: String, default: null, maxlength: 64 },
    revokedAt: { type: Date, default: null },
    replacedBy: { type: Schema.Types.ObjectId, ref: 'Session', default: null },
    lastUsedAt: { type: Date, default: () => new Date() },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, versionKey: false },
)

/** Expired sessions are removed automatically. */
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const Session = model<SessionDoc>('Session', sessionSchema)
