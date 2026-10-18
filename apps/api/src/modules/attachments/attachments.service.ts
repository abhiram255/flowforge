import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import type { AttachmentDTO } from '@flowforge/shared'
import { env } from '../../config/env'
import { getStorageDriver } from '../../config/storage'
import { recordActivity } from '../../lib/activity'
import type { WorkspaceContext } from '../../lib/context'
import { AppError } from '../../lib/errors'
import { hasAtLeast } from '../../lib/permissions'
import { toAttachmentDTO } from '../../lib/serialize'
import { uniq } from '../../lib/utils'
import { Attachment, type AttachmentDoc } from '../../models/Attachment'
import { User } from '../../models/User'
import { emitToWorkspace } from '../../realtime/io'

/** Explicit allow-list — SVG is deliberately excluded (stored XSS vector). */
export const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/json',
  'application/zip',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
])

export interface UploadedFile {
  /** Temp path the upload was parked at (removed by the route after handling). */
  path: string
  originalname: string
  mimetype: string
  size: number
}

export function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .trim()
    .slice(0, 180)
  return cleaned.length > 0 ? cleaned : 'file'
}

async function decorateAttachments(docs: AttachmentDoc[]): Promise<AttachmentDTO[]> {
  if (docs.length === 0) return []
  const uploaderIds = uniq(docs.map((doc) => String(doc.uploaderId)))
  const uploaders = await User.find({ _id: { $in: uploaderIds } })
    .select('name avatarUrl')
    .lean()
  const uploaderById = new Map(uploaders.map((uploader) => [String(uploader._id), uploader]))
  return docs.map((doc) => toAttachmentDTO(doc, uploaderById.get(String(doc.uploaderId)) ?? null))
}

export async function listAttachments(ctx: WorkspaceContext): Promise<AttachmentDTO[]> {
  if (!ctx.task) throw AppError.internal('Task context missing')
  const docs = await Attachment.find({ workspaceId: ctx.workspace._id, taskId: ctx.task._id })
    .sort({ createdAt: -1 })
    .lean<AttachmentDoc[]>()
  return decorateAttachments(docs)
}

export async function uploadAttachment(
  ctx: WorkspaceContext,
  file: UploadedFile,
): Promise<AttachmentDTO> {
  if (!ctx.task) throw AppError.internal('Task context missing')
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    throw AppError.unsupportedFileType(`Unsupported file type "${file.mimetype}"`)
  }
  if (file.size > env.maxUploadBytes) {
    throw AppError.payloadTooLarge(`Files are limited to ${env.MAX_UPLOAD_MB} MB`)
  }

  const extension = path
    .extname(file.originalname)
    .slice(0, 12)
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, '')
  const storageKey = `${String(ctx.workspace._id)}/${String(ctx.task._id)}/${randomUUID()}${extension}`

  const driver = getStorageDriver()
  // Streamed from the temp file — a 10 MB upload never sits in the heap.
  await driver.putStream(storageKey, createReadStream(file.path), file.mimetype, file.size)

  const attachment = await Attachment.create({
    workspaceId: ctx.workspace._id,
    taskId: ctx.task._id,
    uploaderId: ctx.membership.userId,
    storageKey,
    filename: sanitizeFilename(file.originalname),
    mimeType: file.mimetype,
    size: file.size,
  })

  await recordActivity(ctx.workspace._id, ctx.membership.userId, {
    action: 'attachment.uploaded',
    entityType: 'attachment',
    entityId: attachment._id,
    projectId: ctx.task.projectId,
    taskId: ctx.task._id,
    metadata: { filename: attachment.filename, size: attachment.size },
  })

  const [dto] = await decorateAttachments([attachment.toObject() as AttachmentDoc])
  emitToWorkspace(String(ctx.workspace._id), 'attachment:created', {
    attachment: dto,
    taskId: String(ctx.task._id),
  })
  return dto as AttachmentDTO
}

/** Loads an attachment by id; tenancy is enforced by the caller before streaming. */
export async function getAttachmentOrThrow(attachmentId: string): Promise<AttachmentDoc> {
  const attachment = await Attachment.findById(attachmentId).lean<AttachmentDoc>()
  if (!attachment) throw AppError.notFound('Attachment not found')
  return attachment
}

export async function deleteAttachment(ctx: WorkspaceContext, attachmentId: string): Promise<void> {
  const attachment = await Attachment.findOne({
    _id: attachmentId,
    workspaceId: ctx.workspace._id,
  }).lean<AttachmentDoc>()
  if (!attachment) throw AppError.notFound('Attachment not found')

  const isUploader = String(attachment.uploaderId) === String(ctx.membership.userId)
  if (!isUploader && !hasAtLeast(ctx.role, 'admin')) {
    throw AppError.forbidden('Only the uploader or an admin can delete this attachment')
  }

  const driver = getStorageDriver()
  await driver.delete(attachment.storageKey).catch(() => undefined)
  await Attachment.deleteOne({ _id: attachment._id })

  await recordActivity(ctx.workspace._id, ctx.membership.userId, {
    action: 'attachment.deleted',
    entityType: 'attachment',
    entityId: attachment._id,
    taskId: attachment.taskId,
    metadata: { filename: attachment.filename },
  })
  emitToWorkspace(String(ctx.workspace._id), 'attachment:deleted', {
    attachmentId: String(attachment._id),
    taskId: String(attachment.taskId),
  })
}
