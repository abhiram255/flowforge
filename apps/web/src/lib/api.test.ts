import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserDTO } from '@flowforge/shared'
import { ApiError, apiFetch, setAccessToken, setSessionHandler } from './api'

const userFixture: UserDTO = {
  id: '507f1f77bcf86cd799439011',
  name: 'Test User',
  email: 'test@flowforge.dev',
  avatarUrl: null,
  preferences: { theme: 'dark', emailNotifications: true, inAppNotifications: true },
  createdAt: new Date(0).toISOString(),
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

describe('api client', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    setAccessToken('token-1')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    setAccessToken(null)
    setSessionHandler(() => undefined)
  })

  it('attaches the bearer token to authenticated requests', async () => {
    fetchMock.mockResolvedValueOnce(json({ ok: true }))
    await apiFetch('/workspaces')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-1')
    expect(init.credentials).toBe('include')
  })

  it('refreshes a single time for concurrent 401s and retries the requests', async () => {
    let refreshCalls = 0
    let protectedCalls = 0

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/auth/refresh')) {
        refreshCalls += 1
        await new Promise((resolve) => setTimeout(resolve, 5))
        return json({ accessToken: 'token-2', user: userFixture })
      }
      protectedCalls += 1
      if (protectedCalls <= 2) return json({ error: { code: 'TOKEN_EXPIRED', message: 'expired' } }, 401)
      return json({ ok: true })
    })

    const [a, b] = await Promise.all([apiFetch('/alpha'), apiFetch('/beta')])

    expect(a).toEqual({ ok: true })
    expect(b).toEqual({ ok: true })
    // One shared refresh for both 401s — never two, which would trip reuse detection.
    expect(refreshCalls).toBe(1)
  })

  it('surfaces the server error envelope as a typed ApiError', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ error: { code: 'VERSION_CONFLICT', message: 'Task changed', details: { latestVersion: 4 } } }, 409),
    )

    await expect(apiFetch('/tasks/1', { method: 'PATCH', body: { title: 'x' } })).rejects.toMatchObject({
      status: 409,
      code: 'VERSION_CONFLICT',
      message: 'Task changed',
    })
  })

  it('clears the session when the refresh flow fails', async () => {
    const onSession = vi.fn()
    setSessionHandler(onSession)

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/auth/refresh')) {
        return json({ error: { code: 'TOKEN_INVALID', message: 'invalid' } }, 401)
      }
      return json({ error: { code: 'TOKEN_EXPIRED', message: 'expired' } }, 401)
    })

    await expect(apiFetch('/workspaces')).rejects.toBeInstanceOf(ApiError)
    expect(onSession).toHaveBeenCalledWith(null)
  })

  it('returns undefined for 204 responses', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await expect(apiFetch('/auth/logout', { method: 'POST' })).resolves.toBeUndefined()
  })
})
