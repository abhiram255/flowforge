import { Schema, model, type Types } from 'mongoose'
import { THEMES, type Theme } from '@flowforge/shared'

export interface UserPreferences {
  theme: Theme
  emailNotifications: boolean
  inAppNotifications: boolean
}

export interface UserDoc {
  _id: Types.ObjectId
  name: string
  email: string
  passwordHash: string
  avatarUrl: string | null
  preferences: UserPreferences
  createdAt: Date
  updatedAt: Date
}

const userSchema = new Schema<UserDoc>(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true, select: false },
    avatarUrl: { type: String, default: null },
    preferences: {
      theme: { type: String, enum: THEMES, default: 'dark' },
      emailNotifications: { type: Boolean, default: true },
      inAppNotifications: { type: Boolean, default: true },
    },
  },
  { timestamps: true, versionKey: false },
)

export const User = model<UserDoc>('User', userSchema)
