import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import {
  app,
  auth,
  connectTestDatabase,
  disconnectTestDatabase,
  registerUser,
} from './helpers'

function extractRefreshCookie(response: request.Response): string {
  const header = response.headers['set-cookie'] as unknown as string[] | undefined
  const cookie = header?.find((entry) => entry.startsWith('ff_rt='))
  if (!cookie) throw new Error('refresh cookie missing')
  return cookie.split(';')[0] as string
}

describe('auth', () => {
  beforeAll(async () => {
    await connectTestDatabase()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it('registers a user, returns tokens and sets an httpOnly refresh cookie', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Ada Lovelace', email: 'ada@test.local', password: 'Password123!' })

    expect(response.status).toBe(201)
    expect(response.body.user.email).toBe('ada@test.local')
    expect(response.body.user.passwordHash).toBeUndefined()
    expect(typeof response.body.accessToken).toBe('string')

    const cookie = extractRefreshCookie(response)
    expect(cookie).toContain('ff_rt=')
    expect(response.headers['set-cookie']?.[0]).toContain('HttpOnly')
  })

  it('rejects duplicate emails with 409 EMAIL_TAKEN', async () => {
    await registerUser({ email: 'dupe@test.local' })
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Dupe', email: 'dupe@test.local', password: 'Password123!' })

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('EMAIL_TAKEN')
  })

  it('rejects weak passwords and invalid emails with validation details', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'X', email: 'not-an-email', password: 'short' })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_FAILED')
    expect(Array.isArray(response.body.error.details)).toBe(true)
  })

  it('logs in with valid credentials and rejects bad passwords', async () => {
    const user = await registerUser({ email: 'login@test.local' })

    const bad = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'WrongPassword1' })
    expect(bad.status).toBe(401)
    expect(bad.body.error.code).toBe('INVALID_CREDENTIALS')

    const good = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'Password123!' })
    expect(good.status).toBe(200)
    expect(good.body.user.id).toBe(user.id)
  })

  it('rotates refresh tokens and returns a fresh access token', async () => {
    const user = await registerUser({ email: 'rotate@test.local' })
    const first = await user.agent.post('/api/v1/auth/refresh').send({})
    expect(first.status).toBe(200)
    expect(typeof first.body.accessToken).toBe('string')

    const me = await request(app).get('/api/v1/users/me').set(auth(first.body.accessToken))
    expect(me.status).toBe(200)
    expect(me.body.user.email).toBe(user.email)
  })

  it('detects refresh token reuse and revokes the whole session family', async () => {
    const registerResponse = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Reuse User', email: 'reuse@test.local', password: 'Password123!' })
    const original = extractRefreshCookie(registerResponse)

    // Build a rotation chain: original → c1 → c2
    const firstRefresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', original)
      .send({})
    expect(firstRefresh.status).toBe(200)
    const c1 = extractRefreshCookie(firstRefresh)

    const secondRefresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', c1)
      .send({})
    expect(secondRefresh.status).toBe(200)
    const c2 = extractRefreshCookie(secondRefresh)

    // Replaying the original token, whose successor chain is now rotated,
    // is unambiguously theft.
    const replay = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', original)
      .send({})
    expect(replay.status).toBe(401)
    expect(replay.body.error.code).toBe('REFRESH_REUSE_DETECTED')

    // Family revocation: the previously live token is now dead too.
    const afterRevocation = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', c2)
      .send({})
    expect(afterRevocation.status).toBe(401)
  })

  it('tolerates legitimate concurrent refreshes from multiple tabs', async () => {
    const registerResponse = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Tabs User', email: 'tabs@test.local', password: 'Password123!' })
    const original = extractRefreshCookie(registerResponse)

    const firstTab = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', original)
      .send({})
    expect(firstTab.status).toBe(200)

    // A second tab presenting the same token moments later is a normal
    // concurrent refresh — it must be served, not treated as theft.
    const secondTab = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', original)
      .send({})
    expect(secondTab.status).toBe(200)
    expect(typeof secondTab.body.accessToken).toBe('string')
  })

  it('logs out, revoking the refresh session', async () => {
    const user = await registerUser({ email: 'logout@test.local' })
    const logout = await user.agent
      .post('/api/v1/auth/logout')
      .set(auth(user.accessToken))
      .send({})
    expect(logout.status).toBe(204)

    const refresh = await user.agent.post('/api/v1/auth/refresh').send({})
    expect(refresh.status).toBe(401)
  })

  it('requires authentication for protected endpoints', async () => {
    const response = await request(app).get('/api/v1/users/me')
    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('AUTH_REQUIRED')
  })

  it('lists active sessions and allows revoking them', async () => {
    const user = await registerUser({ email: 'sessions@test.local' })

    const list = await request(app).get('/api/v1/auth/sessions').set(auth(user.accessToken))
    expect(list.status).toBe(200)
    expect(list.body.data.length).toBeGreaterThanOrEqual(1)
    expect(list.body.data.some((session: { current: boolean }) => session.current)).toBe(true)

    const otherSession = list.body.data.find((session: { current: boolean }) => !session.current)
    if (otherSession) {
      const revoke = await request(app)
        .delete(`/api/v1/auth/sessions/${otherSession.id}`)
        .set(auth(user.accessToken))
      expect(revoke.status).toBe(204)
    }
  })

  it('updates profile and notification preferences', async () => {
    const user = await registerUser({ email: 'profile@test.local' })

    const profile = await request(app)
      .patch('/api/v1/users/me')
      .set(auth(user.accessToken))
      .send({ name: 'Renamed Person' })
    expect(profile.status).toBe(200)
    expect(profile.body.user.name).toBe('Renamed Person')

    const preferences = await request(app)
      .patch('/api/v1/users/me/preferences')
      .set(auth(user.accessToken))
      .send({ theme: 'light', inAppNotifications: false })
    expect(preferences.status).toBe(200)
    expect(preferences.body.user.preferences.theme).toBe('light')
    expect(preferences.body.user.preferences.inAppNotifications).toBe(false)
  })
})
