import {
  BarChart3,
  FolderKanban,
  LayoutDashboard,
  Settings,
  Users,
} from 'lucide-react'
import type { ReactElement } from 'react'
import { NavLink } from 'react-router-dom'
import type { ProjectDTO, WorkspaceDTO } from '@flowforge/shared'
import { cn } from '@/lib/utils'

export function SidebarNav({
  workspace,
  projects,
}: {
  workspace: WorkspaceDTO | null
  projects: ProjectDTO[]
}): ReactElement {
  if (!workspace) {
    return (
      <p className="px-2 text-sm text-muted-foreground">
        Create your first workspace to get started.
      </p>
    )
  }

  const base = `/app/${workspace.slug}`
  const items = [
    { to: base, label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: `${base}/projects`, label: 'Projects', icon: FolderKanban, end: false },
    { to: `${base}/team`, label: 'Team', icon: Users, end: false },
    { to: `${base}/analytics`, label: 'Analytics', icon: BarChart3, end: false },
    { to: `${base}/settings`, label: 'Settings', icon: Settings, end: false },
  ]

  return (
    <nav className="space-y-6">
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.label}>
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                  isActive && 'bg-muted text-foreground',
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>

      <div>
        <p className="px-2.5 pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Projects
        </p>
        {projects.length === 0 ? (
          <p className="px-2.5 text-sm text-muted-foreground">No projects yet</p>
        ) : (
          <ul className="space-y-0.5">
            {projects.slice(0, 8).map((project) => (
              <li key={project.id}>
                <NavLink
                  to={`${base}/projects/${project.id}`}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                      isActive && 'bg-muted text-foreground',
                    )
                  }
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded bg-primary/15 text-[10px] font-semibold text-primary">
                    {project.key.slice(0, 2)}
                  </span>
                  <span className="truncate">{project.name}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        )}
      </div>
    </nav>
  )
}
