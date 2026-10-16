import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  ArchiveRestore,
  FolderKanban,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { useState, type ReactElement } from 'react'
import { Link } from 'react-router-dom'
import { TASK_STATUS_LABELS, TASK_STATUSES, type ProjectDTO } from '@flowforge/shared'
import api, { ApiError } from '@/lib/api'
import { qk } from '@/lib/query'
import { cn, formatRelative } from '@/lib/utils'
import { PageHeader } from '@/components/common/PageHeader'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState, LoadingScreen } from '@/components/ui/feedback'
import { canManage, canWrite, useWorkspace } from '@/hooks/useWorkspace'
import { ProjectDialog } from './ProjectDialog'
import { toast } from 'sonner'

function ProgressBar({ project }: { project: ProjectDTO }): ReactElement {
  const counts = project.taskCounts
  const total = project.totalTasks ?? 0
  const done = counts?.done ?? 0
  const percent = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="ff-label text-muted-foreground">
          {done}/{total} done
        </span>
        <span className="ff-num text-xs font-medium">{percent}%</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500 ease-expo"
          style={{ width: `${percent}%` }}
        />
      </div>
      {counts ? (
        <div className="mt-3.5 flex flex-wrap gap-1.5">
          {TASK_STATUSES.filter((status) => counts[status] > 0).map((status) => (
            <span
              key={status}
              className="ff-label rounded-sm border border-border bg-surface-2 px-1.5 py-1 text-muted-foreground"
            >
              {TASK_STATUS_LABELS[status]} · {counts[status]}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function ProjectsPage(): ReactElement {
  const workspace = useWorkspace()
  const queryClient = useQueryClient()
  const [includeArchived, setIncludeArchived] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<ProjectDTO | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: [...qk.projects(workspace.id), includeArchived],
    queryFn: () =>
      api.get<{ data: ProjectDTO[] }>(
        `/workspaces/${workspace.id}/projects${includeArchived ? '?includeArchived=true' : ''}`,
      ),
  })

  const setStatus = useMutation({
    mutationFn: ({ project, status }: { project: ProjectDTO; status: 'active' | 'archived' }) =>
      api.patch(`/projects/${project.id}`, { status }),
    onSuccess: () => {
      toast.success('Project updated')
      void queryClient.invalidateQueries({ queryKey: qk.projects(workspace.id) })
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not update the project'),
  })

  const remove = useMutation({
    mutationFn: (project: ProjectDTO) => api.del(`/projects/${project.id}`),
    onSuccess: () => {
      toast.success('Project deleted')
      void queryClient.invalidateQueries({ queryKey: qk.projects(workspace.id) })
      void queryClient.invalidateQueries({ queryKey: qk.tasksRoot })
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not delete the project'),
  })

  const projects = data?.data ?? []

  return (
    <div>
      <PageHeader
        eyebrow="Workspace"
        title="Projects"
        description="Each project is a Kanban board with its own task key."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setIncludeArchived((v) => !v)}>
              {includeArchived ? 'Hide archived' : 'Show archived'}
            </Button>
            {canWrite(workspace.role) ? (
              <ProjectDialog
                workspaceId={workspace.id}
                trigger={
                  <Button size="sm">
                    <Plus /> New project
                  </Button>
                }
              />
            ) : null}
          </>
        }
      />

      {isLoading ? (
        <LoadingScreen label="Loading projects…" />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={<FolderKanban className="h-6 w-6" />}
          title="No projects yet"
          description="Create your first project to start tracking work on a board."
          action={
            canWrite(workspace.role) ? (
              <ProjectDialog
                workspaceId={workspace.id}
                trigger={<Button size="sm">Create project</Button>}
              />
            ) : undefined
          }
        />
      ) : (
        <div className="ff-stagger grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <Card
              key={project.id}
              className={cn(
                'ff-panel-hover flex flex-col',
                project.status === 'archived' && 'opacity-70',
              )}
            >
              <CardContent className="flex flex-1 flex-col gap-4 p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="ff-num rounded-sm border border-primary/35 bg-primary-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary">
                        {project.key}
                      </span>
                      {project.status === 'archived' ? (
                        <span className="ff-label text-muted-foreground">Archived</span>
                      ) : null}
                    </div>
                    <Link
                      to={`/app/${workspace.slug}/projects/${project.id}`}
                      className="mt-2.5 block truncate text-sm font-semibold tracking-tight transition-colors duration-150 hover:text-primary"
                    >
                      {project.name}
                    </Link>
                    {project.description ? (
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                        {project.description}
                      </p>
                    ) : null}
                  </div>

                  {canManage(workspace.role) ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label="Project actions">
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <ProjectDialog
                          workspaceId={workspace.id}
                          project={project}
                          trigger={
                            <DropdownMenuItem onSelect={(event) => event.preventDefault()}>
                              <Pencil className="h-4 w-4" /> Edit details
                            </DropdownMenuItem>
                          }
                        />
                        <DropdownMenuItem
                          onSelect={() =>
                            setStatus.mutate({
                              project,
                              status: project.status === 'archived' ? 'active' : 'archived',
                            })
                          }
                        >
                          {project.status === 'archived' ? (
                            <>
                              <ArchiveRestore className="h-4 w-4" /> Restore project
                            </>
                          ) : (
                            <>
                              <Archive className="h-4 w-4" /> Archive project
                            </>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onSelect={() => setPendingDelete(project)}
                        >
                          <Trash2 className="h-4 w-4" /> Delete project
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>

                <div className="mt-auto">
                  <ProgressBar project={project} />
                  <p className="ff-num mt-3 text-[10px] uppercase text-muted-foreground">
                    Updated {formatRelative(project.updatedAt)}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={`Delete ${pendingDelete?.name ?? 'project'}?`}
        description="This removes the project, its tasks, comments and attachments. This cannot be undone."
        confirmLabel="Delete project"
        destructive
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete)
        }}
      />
    </div>
  )
}
