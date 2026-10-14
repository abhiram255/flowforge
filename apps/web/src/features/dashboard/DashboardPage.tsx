import { useQuery } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { Link } from 'react-router-dom'
import type { DashboardDTO, TaskDTO } from '@flowforge/shared'
import api from '@/lib/api'
import { qk } from '@/lib/query'
import { dueDateMeta } from '@/lib/utils'
import { ActivityFeed } from '@/components/common/ActivityFeed'
import { StatCard } from '@/components/common/PageHeader'
import { PriorityBadge, StatusBadge } from '@/components/common/badges'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState, LoadingScreen } from '@/components/ui/feedback'
import { Avatar } from '@/components/ui/avatar'
import { useWorkspace, canWrite } from '@/hooks/useWorkspace'
import { useAuthStore } from '@/stores/auth'
import { ProjectDialog } from '../projects/ProjectDialog'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'

function TaskRow({ task, slug }: { task: TaskDTO; slug: string }): ReactElement {
  const due = dueDateMeta(task.dueDate)
  return (
    <Link
      to={`/app/${slug}/tasks/${task.id}`}
      className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted"
    >
      <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">{task.key}</span>
      <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
      <StatusBadge status={task.status} />
      <PriorityBadge priority={task.priority} />
      <span className={`hidden w-28 shrink-0 text-right text-xs sm:block ${due.className}`}>
        {due.label}
      </span>
    </Link>
  )
}

export function DashboardPage(): ReactElement {
  const workspace = useWorkspace()
  const user = useAuthStore((state) => state.user)

  const { data, isLoading } = useQuery({
    queryKey: qk.dashboard(workspace.id),
    queryFn: () => api.get<{ dashboard: DashboardDTO }>(`/workspaces/${workspace.id}/analytics/dashboard`),
  })

  if (isLoading || !data) return <LoadingScreen label="Loading your dashboard…" />
  const dashboard = data.dashboard

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Good to see you, {user?.name.split(' ')[0] ?? 'there'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Here is what is happening across {workspace.name}.
          </p>
        </div>
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
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="My open tasks" value={dashboard.myOpenTasks} />
        <StatCard
          label="My overdue"
          value={dashboard.myOverdueTasks}
          tone={dashboard.myOverdueTasks > 0 ? 'danger' : 'default'}
        />
        <StatCard label="Completed this week" value={dashboard.myCompletedThisWeek} tone="success" />
        <StatCard
          label="Projects"
          value={dashboard.projectCount}
          hint={`${dashboard.memberCount} member${dashboard.memberCount === 1 ? '' : 's'}`}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Assigned to me</CardTitle>
              <span className="text-xs text-muted-foreground">
                {dashboard.assignedTasks.length} shown
              </span>
            </CardHeader>
            <CardContent>
              {dashboard.assignedTasks.length === 0 ? (
                <EmptyState title="Nothing assigned to you" description="Enjoy the calm — or pick up work from a board." />
              ) : (
                <div className="space-y-1">
                  {dashboard.assignedTasks.map((task) => (
                    <TaskRow key={task.id} task={task} slug={workspace.slug} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Upcoming deadlines</CardTitle>
            </CardHeader>
            <CardContent>
              {dashboard.upcomingDeadlines.length === 0 ? (
                <EmptyState title="No deadlines in the next 7 days" />
              ) : (
                <div className="space-y-1">
                  {dashboard.upcomingDeadlines.map((task) => (
                    <TaskRow key={task.id} task={task} slug={workspace.slug} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Recent activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityFeed entries={dashboard.recentActivity} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Team workload</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {dashboard.workload.length === 0 ? (
                <p className="text-sm text-muted-foreground">No open work assigned yet.</p>
              ) : (
                dashboard.workload.map((entry) => {
                  const max = Math.max(...dashboard.workload.map((item) => item.open), 1)
                  return (
                    <div key={entry.userId} className="flex items-center gap-3">
                      <Avatar name={entry.name} src={entry.avatarUrl} seed={entry.userId} className="h-7 w-7" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="truncate font-medium">{entry.name}</span>
                          <span className="text-muted-foreground">
                            {entry.open} open
                            {entry.overdue > 0 ? (
                              <span className="text-rose-500"> · {entry.overdue} overdue</span>
                            ) : null}
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 rounded-full bg-muted">
                          <div
                            className="h-1.5 rounded-full bg-primary"
                            style={{ width: `${Math.round((entry.open / max) * 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
