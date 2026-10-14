import { Schema, model, type Types } from 'mongoose'
import { ROLES, type Role } from '@flowforge/shared'

export interface MembershipDoc {
  _id: Types.ObjectId
  workspaceId: Types.ObjectId
  userId: Types.ObjectId
  role: Role
  joinedAt: Date
  createdAt: Date
  updatedAt: Date
}

const membershipSchema = new Schema<MembershipDoc>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: ROLES, required: true },
    joinedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true, versionKey: false },
)

/** One membership per (workspace, user) — the core tenancy constraint. */
membershipSchema.index({ workspaceId: 1, userId: 1 }, { unique: true })

export const Membership = model<MembershipDoc>('Membership', membershipSchema)
