import type { AuthContext, WorkspaceContext } from '../lib/context'

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext
      ctx?: WorkspaceContext
    }
  }
}

export {}
