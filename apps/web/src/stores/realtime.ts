import { create } from 'zustand'

export type LinkState = 'connecting' | 'live' | 'offline'

interface RealtimeState {
  /** Sockets currently joined to the active workspace. */
  online: number
  /** Live state of the socket connection backing the presence count. */
  link: LinkState
  /** Who is viewing each open project board. */
  projectViewers: Record<string, string[]>
  setOnline: (online: number) => void
  setLink: (link: LinkState) => void
  setProjectViewers: (projectId: string, viewers: string[]) => void
}

export const useRealtimeStore = create<RealtimeState>((set) => ({
  online: 0,
  link: 'connecting',
  projectViewers: {},
  setOnline: (online) => set({ online }),
  setLink: (link) => set({ link }),
  setProjectViewers: (projectId, viewers) =>
    set((state) => ({ projectViewers: { ...state.projectViewers, [projectId]: viewers } })),
}))
