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
import { NotificationsMenu } from '@/features/notifications/NotificationsMenu'
import { SidebarNav } from './SidebarNav'
import { UserMenu } from './UserMenu'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'

export function AppShell(): ReactElement {
  const workspace = useWorkspaceOptional()
  useRealtime(workspace?.id)

  const location = useLocation()
  const { sidebarOpen, setSidebarOpen } = useUiStore()
  const online = useRealtimeStore((state) => state.online)

  useEffect(() => {
    setSidebarOpen(false)
  }, [location.pathname, setSidebarOpen])

  const projectsQuery = useQuery({
    queryKey: qk.projects(workspace?.id),
    queryFn: () => api.get<{ data: ProjectDTO[] }>(`/workspaces/${workspace!.id}/projects`),
    enabled: Boolean(workspace?.id),
  })

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-sidebar transition-transform lg:static lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 items-center justify-between border-b border-border px-3">
          {workspace ? <WorkspaceSwitcher workspace={workspace} /> : <BrandMark />}
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

        {workspace ? (
          <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 align-middle" />
            {online} {online === 1 ? 'person' : 'people'} online
          </div>
        ) : null}
      </aside>

      {sidebarOpen ? (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur lg:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => useUiStore.getState().toggleSidebar()}
            aria-label="Open navigation"
          >
            <Menu />
          </Button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {workspace ? workspace.name : 'FlowForge'}
            </p>
          </div>

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

function BrandMark(): ReactElement {
  return (
    <div className="flex items-center gap-2 px-2">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
        F
      </span>
      <span className="text-sm font-semibold tracking-tight">FlowForge</span>
    </div>
  )
}
