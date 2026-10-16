import { useQuery } from '@tanstack/react-query'
import { Menu, X } from 'lucide-react'
import type { ReactElement } from 'react'
import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import type { ProjectDTO } from '@flowforge/shared'
import api from '@/lib/api'
import { qk } from '@/lib/query'
import { cn } from '@/lib/utils'
import { useRealtime } from '@/hooks/useRealtime'
import { useWorkspaceOptional } from '@/hooks/useWorkspace'
import { useRealtimeStore } from '@/stores/realtime'
import { useUiStore } from '@/stores/ui'
import { Button } from '@/components/ui/button'
import { BrandMark } from '@/components/common/BrandMark'
import { NotificationsMenu } from '@/features/notifications/NotificationsMenu'
import { SidebarNav } from './SidebarNav'
import { UserMenu } from './UserMenu'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'

const LINK_COPY = {
  connecting: { label: 'Linking', dot: 'bg-warning' },
  live: { label: 'Live', dot: 'ff-dot-live' },
  offline: { label: 'Offline', dot: 'bg-destructive' },
} as const

export function AppShell(): ReactElement {
  const workspace = useWorkspaceOptional()
  useRealtime(workspace?.id)

  const location = useLocation()
  const { sidebarOpen, setSidebarOpen } = useUiStore()
  const online = useRealtimeStore((state) => state.online)
  const link = useRealtimeStore((state) => state.link)
  const linkCopy = LINK_COPY[link]

  useEffect(() => {
    setSidebarOpen(false)
  }, [location.pathname, setSidebarOpen])

  const projectsQuery = useQuery({
    queryKey: qk.projects(workspace?.id),
    queryFn: () => api.get<{ data: ProjectDTO[] }>(`/workspaces/${workspace!.id}/projects`),
    enabled: Boolean(workspace?.id),
  })

  return (
    <div className="flex min-h-screen">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-sidebar/95 backdrop-blur-md transition-transform duration-200 ease-quart lg:static lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 items-center justify-between gap-2 border-b border-border px-3">
          {workspace ? <WorkspaceSwitcher workspace={workspace} /> : <BrandMark showName />}
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation"
          >
            <X />
          </Button>
        </div>

        <div className="scrollbar-thin flex-1 overflow-y-auto px-3 py-4">
          <SidebarNav workspace={workspace} projects={projectsQuery.data?.data ?? []} />
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
          <span className="ff-label text-muted-foreground">Presence</span>
          <span className="ff-num flex items-center gap-1.5 text-xs text-muted-foreground">
            <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', linkCopy.dot)} />
            {online}
          </span>
        </div>
      </aside>

      {sidebarOpen ? (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-md lg:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => useUiStore.getState().toggleSidebar()}
            aria-label="Open navigation"
          >
            <Menu />
          </Button>

          <div className="flex min-w-0 flex-1 items-baseline gap-2.5">
            <p className="truncate text-sm font-medium tracking-tight">
              {workspace ? workspace.name : 'FlowForge'}
            </p>
            {workspace ? (
              <span className="ff-num hidden truncate text-[11px] text-muted-foreground sm:block">
                /{workspace.slug}
              </span>
            ) : null}
          </div>

          <span
            className="flex h-8 items-center gap-2 rounded-md border border-border bg-surface-1/70 px-2.5"
            title={`Realtime link: ${link}`}
          >
            <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', linkCopy.dot)} />
            <span className="ff-label text-muted-foreground">{linkCopy.label}</span>
          </span>

          <NotificationsMenu />
          <UserMenu />
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
