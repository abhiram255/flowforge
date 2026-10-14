import { Types, type FilterQuery } from 'mongoose'
import type { NotificationDTO, NotificationType, Paginated } from '@flowforge/shared'
import { enqueue } from '../../jobs/queue'
import { cursorFilter, finalizePage, clampLimit, parseCursor } from '../../lib/pagination'
import { toNotificationDTO } from '../../lib/serialize'
import { uniq } from '../../lib/utils'
import { Notification, type NotificationDoc } from '../../models/Notification'
import { User } from '../../models/User'
import { AppError } from '../../lib/errors'

export interface NotifyInput {
  workspaceId: Types.ObjectId | string
  actorId: Types.ObjectId | string | null
  recipientIds: Array<Types.ObjectId | string>
  type: NotificationType
  title: string
  body?: string
  link?: string | null
  entityId?: Types.ObjectId | string | null
}

/**
 * Persists notifications, then hands delivery to the job queue. Recipients who
 * disabled in-app notifications are filtered out before writing.
 */
export async function notify(input: NotifyInput): Promise<void> {
  const recipients = uniq(input.recipientIds.map(String)).filter(
    (id) => id && id !== String(input.actorId ?? ''),
  )
  if (recipients.length === 0) return

  const users = await User.find({ _id: { $in: recipients } })
    .select('preferences')
    .lean()
  const allowed = users
    .filter((user) => user.preferences?.inAppNotifications !== false)
    .map((user) => String(user._id))
  if (allowed.length === 0) return

  const docs = await Notification.insertMany(
    allowed.map((userId) => ({
      workspaceId: input.workspaceId,
      userId,
      actorId: input.actorId ?? null,
      type: input.type,
      title: input.title,
      body: input.body ?? '',
      link: input.link ?? null,
      entityId: input.entityId ?? null,
    })),
  )

  await enqueue('deliver-notifications', {
    items: docs.map((doc) => ({ userId: String(doc.userId), notificationId: String(doc._id) })),
  })
}

async function decorate(docs: NotificationDoc[]): Promise<NotificationDTO[]> {
  const actorIds = uniq(docs.map((doc) => String(doc.actorId)).filter((id) => id && id !== 'null'))
  const actors = await User.find({ _id: { $in: actorIds } })
    .select('name avatarUrl')
    .lean()
  const actorById = new Map(actors.map((actor) => [String(actor._id), actor]))
  return docs.map((doc) =>
    toNotificationDTO(doc, doc.actorId ? actorById.get(String(doc.actorId)) ?? null : null),
  )
}

export interface ListNotificationsQuery {
  limit?: number
  cursor?: string
  unreadOnly?: boolean
  workspaceId?: string
}

export async function listNotifications(
  userId: string,
  query: ListNotificationsQuery,
): Promise<Paginated<NotificationDTO>> {
  const limit = clampLimit(query.limit)
  const filter: FilterQuery<NotificationDoc> = { userId, ...cursorFilter(parseCursor(query.cursor)) }
  if (query.unreadOnly) filter.readAt = null
  if (query.workspaceId && Types.ObjectId.isValid(query.workspaceId)) {
    filter.workspaceId = new Types.ObjectId(query.workspaceId)
  }

  const docs = await Notification.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean<NotificationDoc[]>()
  const page = finalizePage(docs, limit)
  return {
    data: await decorate(page.data),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  }
}

export async function unreadNotificationCount(userId: string): Promise<number> {
  return Notification.countDocuments({ userId, readAt: null })
}

export async function markNotificationRead(userId: string, notificationId: string): Promise<void> {
  const result = await Notification.findOneAndUpdate(
    { _id: notificationId, userId },
    { $set: { readAt: new Date() } },
  )
  if (!result) throw AppError.notFound('Notification not found')
}

export async function markAllNotificationsRead(userId: string, workspaceId?: string): Promise<number> {
  const filter: FilterQuery<NotificationDoc> = { userId, readAt: null }
  if (workspaceId && Types.ObjectId.isValid(workspaceId)) {
    filter.workspaceId = new Types.ObjectId(workspaceId)
  }
  const result = await Notification.updateMany(filter, { $set: { readAt: new Date() } })
  return result.modifiedCount
}
