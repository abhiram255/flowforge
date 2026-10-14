import type { NextFunction, Request, RequestHandler, Response } from 'express'

type AsyncRoute = (req: Request, res: Response, next: NextFunction) => Promise<unknown>

/** Wraps async route handlers so rejected promises reach the error middleware. */
export const asyncHandler =
  (fn: AsyncRoute): RequestHandler =>
  (req, res, next) => {
    void Promise.resolve(fn(req, res, next)).catch(next)
  }
