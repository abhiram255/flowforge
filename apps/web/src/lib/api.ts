import type { UserDTO } from '@flowforge/shared'

const API_BASE = '/api/v1'

let accessToken: string | null = null

export const setAccessToken = (token: string | null): void => {
  accessToken = token
}
export const getAccessToken = (): string | null => accessToken

type SessionHandler = (user: UserDTO | null) => void
let onSessionChange: SessionHandler = () => undefined
export const setSessionHandler = (handler: SessionHandler): void => {
  onSessionChange = handler
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  formData?: FormData
  auth?: boolean
}

/**
 * Single-flight refresh: concurrent 401s share one refresh call, so a burst of
 * parallel requests can never trigger refresh-token reuse detection.
 */
let refreshInFlight: Promise<UserDTO | null> | null = null

export async function refreshSession(): Promise<UserDTO | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const response = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
        if (!response.ok) return null
        const payload = (await response.json()) as { accessToken: string; user: UserDTO }
        setAccessToken(payload.accessToken)
        return payload.user
      } catch {
        return null
      } finally {
        refreshInFlight = null
      }
    })()
  }
  return refreshInFlight
}

export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, formData, auth = true } = options

  const request = (token: string | null): Promise<Response> =>
    fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'include',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined && !formData ? { 'Content-Type': 'application/json' } : {}),
      },
      body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
    })

  let response = await request(auth ? accessToken : null)

  if (response.status === 401 && auth) {
    const user = await refreshSession()
    if (user) {
      onSessionChange(user)
      response = await request(accessToken)
    } else {
      setAccessToken(null)
      onSessionChange(null)
      throw new ApiError(401, 'AUTH_REQUIRED', 'Your session expired — please sign in again')
    }
  }

  if (response.status === 204) return undefined as T

  const payload = (await response.json().catch(() => null)) as
    | { error?: { code?: string; message?: string; details?: unknown } }
    | null

  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.error?.code ?? 'INTERNAL_ERROR',
      payload?.error?.message ?? 'Request failed',
      payload?.error?.details,
    )
  }

  return payload as T
}

export async function downloadFile(path: string): Promise<Blob> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    credentials: 'include',
  })
  if (!response.ok) throw new ApiError(response.status, 'DOWNLOAD_FAILED', 'Download failed')
  return response.blob()
}

const api = {
  get: <T>(path: string, options?: Omit<ApiOptions, 'method' | 'body'>) =>
    apiFetch<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<ApiOptions, 'method' | 'body'>) =>
    apiFetch<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, formData: FormData) =>
    apiFetch<T>(path, { method: 'POST', formData, auth: true }),
}

export default api
