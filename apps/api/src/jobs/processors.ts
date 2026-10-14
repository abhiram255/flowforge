import { getMailer, type MailMessage } from '../lib/mailer'
import { toNotificationDTO } from '../lib/serialize'
import { uniq } from '../lib/utils'
import { Notification } from '../models/Notification'
import { User } from '../models/User'
import { emitToUser } from '../realtime/io'

export async function processSendEmail(message: MailMessage): Promise<void> {
  const mailer = await getMailer()
  await mailer.send(message)
}

export interface NotificationDeliveryItem {
  userId: string
  notificationId: string
}

/** Pushes freshly persisted notifications to any open sockets for that user. */
export async function processDeliverNotifications({
  items,
}: {
  items: NotificationDeliveryItem[]
}): Promise<void> {
  if (items.length === 0) return
  const docs = await Notification.find({ _id: { $in: items.map((item) => item.notificationId) } }).lean()
  const actorIds = uniq(docs.map((doc) => String(doc.actorId)).filter((id) => id && id !== 'null'))
  const actors = await User.find({ _id: { $in: actorIds } })
    .select('name avatarUrl')
    .lean()
  const actorById = new Map(actors.map((actor) => [String(actor._id), actor]))

  for (const doc of docs) {
    const actor = doc.actorId ? actorById.get(String(doc.actorId)) ?? null : null
    emitToUser(String(doc.userId), 'notification:created', toNotificationDTO(doc, actor))
  }
}
