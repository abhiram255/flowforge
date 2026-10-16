import { BarChart3, FolderKanban, LayoutDashboard, Settings, Users } from 'lucide-react'
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
      <p className="px-2 text-sm leading-relaxed text-muted-foreground">
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
      <div>
        <p className="ff-label px-3 pb-2 text-muted-foreground">Navigation</p>
        <ul className="space-y-0.5">
          {items.map((item) => (
            <li key={item.label}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'group relative flex items-center gap-2.5 rounded-md py-2 pl-3 pr-2.5 text-sm font-medium transition-colors duration-150 ease-quart',
                    isActive
                      ? 'bg-primary-soft text-foreground'
                      : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      aria-hidden
                      className={cn(
                        'absolute bottom-1.5 left-0 top-1.5 w-[2px] rounded-full transition-colors duration-150',
                        isActive ? 'bg-primary' : 'bg-transparent',
                      )}
                    />
                    <item.icon className={cn('h-4 w-4', isActive ? 'text-primary' : undefined)} />
                    {item.label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="ff-label px-3 pb-2 text-muted-foreground">Projects</p>
        {projects.length === 0 ? (
          <p className="px-3 text-sm text-muted-foreground">No projects yet</p>
        ) : (
          <ul className="space-y-0.5">
            {projects.slice(0, 8).map((project) => (
              <li key={project.id}>
                <NavLink
                  to={`${base}/projects/${project.id}`}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors duration-150 ease-quart',
                      isActive
                        ? 'bg-primary-soft text-foreground'
                        : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
                    )
                  }
                >
                  <span className="ff-num flex h-5 min-w-5 items-center justify-center rounded-sm border border-border-strong/60 bg-surface-2 px-1 text-[9px] font-semibold uppercase text-muted-foreground">
                    {project.key.slice(0, 3)}
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
