import { create } from 'zustand'
import type { UserDTO } from '@flowforge/shared'
import api, { refreshSession, setAccessToken } from '../lib/api'
import { queryClient } from '../lib/query'
import { disconnectSocket } from '../lib/socket'

type AuthStatus = 'loading' | 'authenticated' | 'anonymous'

interface AuthState {
  user: UserDTO | null
  status: AuthStatus
  login: (email: string, password: string) => Promise<void>
  register: (name: string, email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  bootstrap: () => Promise<void>
  handleSession: (user: UserDTO | null) => void
  setUser: (user: UserDTO) => void
}

interface AuthResponse {
  user: UserDTO
  accessToken: string
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  status: 'loading',

  async login(email, password) {
    const response = await api.post<AuthResponse>('/auth/login', { email, password }, { auth: false })
    setAccessToken(response.accessToken)
    queryClient.clear()
    set({ user: response.user, status: 'authenticated' })
  },

  async register(name, email, password) {
    const response = await api.post<AuthResponse>(
      '/auth/register',
      { name, email, password },
      { auth: false },
    )
    setAccessToken(response.accessToken)
    queryClient.clear()
    set({ user: response.user, status: 'authenticated' })
  },

  async logout() {
    try {
      await api.post('/auth/logout')
    } catch {
      /* logging out locally must never fail */
    }
    setAccessToken(null)
    disconnectSocket()
    queryClient.clear()
    set({ user: null, status: 'anonymous' })
  },

  async bootstrap() {
    const user = await refreshSession()
    if (user) {
      set({ user, status: 'authenticated' })
    } else {
      set({ user: null, status: 'anonymous' })
    }
  },

  handleSession(user) {
    if (user) set({ user, status: 'authenticated' })
    else set({ user: null, status: 'anonymous' })
  },

  setUser(user) {
    set({ user })
  },
}))
