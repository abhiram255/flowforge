import { useQuery } from '@tanstack/react-query'
import { Check, ChevronsUpDown, Plus } from 'lucide-react'
import type { ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import type { WorkspaceDTO } from '@flowforge/shared'
import api from '@/lib/api'
import { qk } from '@/lib/query'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { WorkspaceCreateDialog } from '@/features/onboarding/WorkspaceCreateDialog'

export function WorkspaceSwitcher({ workspace }: { workspace: WorkspaceDTO }): ReactElement {
  const navigate = useNavigate()
  const { data } = useQuery({
    queryKey: qk.workspaces,
    queryFn: () => api.get<{ data: WorkspaceDTO[] }>('/workspaces'),
  })
  const workspaces = data?.data ?? []

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-muted">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
          {workspace.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold leading-tight">{workspace.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{workspace.slug}</span>
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {workspaces.map((entry) => (
          <DropdownMenuItem
            key={entry.id}
            onSelect={() => navigate(`/app/${entry.slug}`)}
            className="justify-between"
          >
            <span className="min-w-0 flex-1 truncate">
              {entry.name}
              <span className="ml-2 text-xs text-muted-foreground">{entry.memberCount}</span>
            </span>
            {entry.id === workspace.id ? <Check className="h-4 w-4 text-primary" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <WorkspaceCreateDialog
          trigger={
            <DropdownMenuItem onSelect={(event) => event.preventDefault()} className="gap-2">
              <Plus className="h-4 w-4" />
              Create workspace
            </DropdownMenuItem>
          }
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
