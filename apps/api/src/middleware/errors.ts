import type { ErrorRequestHandler, RequestHandler } from 'express'
import mongoose from 'mongoose'
import multer from 'multer'
import { ZodError } from 'zod'
import { ERROR_CODES } from '@flowforge/shared'
import { AppError, isAppError } from '../lib/errors'
import { logger } from '../config/logger'

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(AppError.notFound('Endpoint not found'))
}

interface ErrorBody {
  error: {
    code: string
    message: string
    details?: unknown
    requestId?: string
  }
}

function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error

  if (error instanceof ZodError) {
    return AppError.validation(
      'Validation failed',
      error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    )
  }

  if (error instanceof mongoose.Error.ValidationError) {
    return AppError.validation(
      'Validation failed',
      Object.values(error.errors).map((issue) => ({ path: issue.path, message: issue.message })),
    )
  }

  if (error instanceof mongoose.Error.CastError) {
    return new AppError(400, ERROR_CODES.VALIDATION_FAILED, `Invalid value for ${error.path}`)
  }

  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return AppError.payloadTooLarge('File exceeds the maximum allowed size')
    }
    return AppError.validation(`Upload error: ${error.message}`)
  }

  const maybeHttpError = error as { status?: number; type?: string; code?: number; keyPattern?: unknown; message?: string }
  if (maybeHttpError?.code === 11000) {
    return AppError.conflict(
      'A record with these values already exists',
      ERROR_CODES.DUPLICATE,
      maybeHttpError.keyPattern,
    )
  }
  if (maybeHttpError?.type === 'entity.parse.failed') {
    return AppError.validation('Malformed JSON body')
  }
  if (maybeHttpError?.status === 413) {
    return AppError.payloadTooLarge()
  }
  if (maybeHttpError?.status === 400 && maybeHttpError?.type === 'entity.too.large') {
    return AppError.payloadTooLarge()
  }

  return AppError.internal()
}

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const appError = toAppError(error)

  if (appError.status >= 500) {
    logger.error({ err: error, requestId: req.id }, 'Unhandled request error')
  }

  const body: ErrorBody = {
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details !== undefined ? { details: appError.details } : {}),
      ...(req.id ? { requestId: String(req.id) } : {}),
    },
  }
  res.status(appError.status).json(body)
}
