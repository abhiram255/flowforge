import { create } from 'zustand'

interface RealtimeState {
  /** Sockets currently joined to the active workspace. */
  online: number
  /** Who is viewing each open project board. */
  projectViewers: Record<string, string[]>
  setOnline: (online: number) => void
  setProjectViewers: (projectId: string, viewers: string[]) => void
}

export const useRealtimeStore = create<RealtimeState>((set) => ({
  online: 0,
  projectViewers: {},
  setOnline: (online) => set({ online }),
  setProjectViewers: (projectId, viewers) =>
    set((state) => ({ projectViewers: { ...state.projectViewers, [projectId]: viewers } })),
}))
