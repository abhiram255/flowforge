import { Schema, model, type Types } from 'mongoose'
import { ASSIGNABLE_ROLES, INVITATION_STATUSES, INVITATION_TTL_DAYS } from '@flowforge/shared'

export interface InvitationDoc {
  _id: Types.ObjectId
  workspaceId: Types.ObjectId
  email: string
  role: (typeof ASSIGNABLE_ROLES)[number]
  invitedById: Types.ObjectId
  tokenHash: string
  status: (typeof INVITATION_STATUSES)[number]
  expiresAt: Date
  createdAt: Date
  updatedAt: Date
}

const invitationSchema = new Schema<InvitationDoc>(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    role: { type: String, enum: ASSIGNABLE_ROLES, required: true },
    invitedById: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true, unique: true },
    status: { type: String, enum: INVITATION_STATUSES, default: 'pending' },
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000),
    },
  },
  { timestamps: true, versionKey: false },
)

invitationSchema.index({ workspaceId: 1, email: 1, status: 1 })
/** Expired invitations clean themselves up. */
invitationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const Invitation = model<InvitationDoc>('Invitation', invitationSchema)
