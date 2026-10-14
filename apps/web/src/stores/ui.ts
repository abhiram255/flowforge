import { create } from 'zustand'
import type { Theme } from '@flowforge/shared'

const THEME_KEY = 'flowforge.theme'

function applyTheme(theme: Theme): void {
  const prefersDark =
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  const dark = theme === 'dark' || (theme === 'system' && prefersDark)
  document.documentElement.classList.toggle('dark', dark)
}

interface UiState {
  theme: Theme
  sidebarOpen: boolean
  setTheme: (theme: Theme) => void
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
}

export const useUiStore = create<UiState>((set) => ({
  theme:
    (typeof localStorage !== 'undefined' && (localStorage.getItem(THEME_KEY) as Theme)) || 'dark',
  sidebarOpen: false,

  setTheme(theme) {
    localStorage.setItem(THEME_KEY, theme)
    applyTheme(theme)
    set({ theme })
  },

  toggleSidebar() {
    set((state) => ({ sidebarOpen: !state.sidebarOpen }))
  },

  setSidebarOpen(open) {
    set({ sidebarOpen: open })
  },
}))

export function initTheme(): void {
  applyTheme(useUiStore.getState().theme)
}
