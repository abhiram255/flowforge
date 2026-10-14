import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { env } from '../../config/env'
import { getStorageDriver } from '../../config/storage'
import { asyncHandler } from '../../lib/asyncHandler'
import { AppError } from '../../lib/errors'
import { isObjectId } from '../../lib/utils'
import { requireAuth } from '../../middleware/auth'
import { requireRole } from '../../middleware/rbac'
import { uploadLimiter } from '../../middleware/rateLimit'
import { validate } from '../../middleware/validate'
import { getCtx, loadWorkspaceContext, requireTask } from '../../middleware/workspace'
import {
  ALLOWED_MIME_TYPES,
  deleteAttachment,
  getAttachmentOrThrow,
  listAttachments,
  uploadAttachment,
} from './attachments.service'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      callback(AppError.unsupportedFileType(`Unsupported file type "${file.mimetype}"`))
      return
    }
    callback(null, true)
  },
})

/** Mounted at /tasks/:taskId/attachments */
export const taskAttachmentsRoutes = Router({ mergeParams: true })
taskAttachmentsRoutes.use(requireAuth)

taskAttachmentsRoutes.get(
  '/',
  requireTask,
  asyncHandler(async (req, res) => {
    res.json({ data: await listAttachments(getCtx(req)) })
  }),
)

taskAttachmentsRoutes.post(
  '/',
  uploadLimiter,
  requireTask,
  requireRole('member'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw AppError.validation('No file provided (expected multipart field "file")')
    const attachment = await uploadAttachment(getCtx(req), {
      buffer: req.file.buffer,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
    })
    res.status(201).json({ attachment })
  }),
)

/** Mounted at /attachments */
export const attachmentsRoutes = Router()
attachmentsRoutes.use(requireAuth)

attachmentsRoutes.get(
  '/:attachmentId/download',
  validate({ params: z.object({ attachmentId: z.string() }) }),
  asyncHandler(async (req, res) => {
    const { attachmentId } = req.params
    if (!isObjectId(attachmentId)) throw AppError.notFound('Attachment not found')

    const attachment = await getAttachmentOrThrow(attachmentId)
    // Enforces workspace membership — non-members get 404, never the file.
    await loadWorkspaceContext(req.auth!.userId, String(attachment.workspaceId))

    const driver = getStorageDriver()
    const stream = await driver.getStream(attachment.storageKey)

    const asciiFallback = attachment.filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '')
    res.setHeader('Content-Type', attachment.mimeType)
    res.setHeader('Content-Length', String(attachment.size))
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
    )
    res.setHeader('X-Content-Type-Options', 'nosniff')
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).end()
      else res.destroy()
    })
    stream.pipe(res)
  }),
)

attachmentsRoutes.delete(
  '/:attachmentId',
  validate({ params: z.object({ attachmentId: z.string() }) }),
  asyncHandler(async (req, res) => {
    const { attachmentId } = req.params
    if (!isObjectId(attachmentId)) throw AppError.notFound('Attachment not found')

    const attachment = await getAttachmentOrThrow(attachmentId)
    const ctx = await loadWorkspaceContext(req.auth!.userId, String(attachment.workspaceId))
    await deleteAttachment(ctx, attachmentId)
    res.status(204).end()
  }),
)
