import { ERROR_CODES, type ErrorCode } from '@flowforge/shared'

export class AppError extends Error {
  readonly status: number
  readonly code: ErrorCode
  readonly details?: unknown

  constructor(status: number, code: ErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'AppError'
    this.status = status
    this.code = code
    this.details = details
    Error.captureStackTrace?.(this, AppError)
  }

  static unauthorized(code: ErrorCode = ERROR_CODES.AUTH_REQUIRED, message = 'Authentication required'): AppError {
    return new AppError(401, code, message)
  }

  static forbidden(message = 'You do not have permission to perform this action'): AppError {
    return new AppError(403, ERROR_CODES.FORBIDDEN, message)
  }

  static notFound(message = 'Resource not found', code: ErrorCode = ERROR_CODES.NOT_FOUND): AppError {
    return new AppError(404, code, message)
  }

  static validation(message = 'Validation failed', details?: unknown): AppError {
    return new AppError(400, ERROR_CODES.VALIDATION_FAILED, message, details)
  }

  static conflict(message: string, code: ErrorCode = ERROR_CODES.CONFLICT, details?: unknown): AppError {
    return new AppError(409, code, message, details)
  }

  static payloadTooLarge(message = 'File is too large'): AppError {
    return new AppError(413, ERROR_CODES.PAYLOAD_TOO_LARGE, message)
  }

  static unsupportedFileType(message = 'Unsupported file type'): AppError {
    return new AppError(415, ERROR_CODES.UNSUPPORTED_FILE_TYPE, message)
  }

  static internal(message = 'Something went wrong'): AppError {
    return new AppError(500, ERROR_CODES.INTERNAL_ERROR, message)
  }
}

export const isAppError = (error: unknown): error is AppError => error instanceof AppError
