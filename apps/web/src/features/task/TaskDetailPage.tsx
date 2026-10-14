import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Pencil, Tag, X } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  PRIORITY_LABELS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  type MemberDTO,
  type TaskDTO,
  type TaskPriority,
  type TaskStatus,
} from '@flowforge/shared'
import api, { ApiError } from '@/lib/api'
import { qk } from '@/lib/query'
import { dueDateMeta, formatDate } from '@/lib/utils'
import { toast } from 'sonner'
import { StatusBadge, PriorityBadge } from '@/components/common/badges'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState, LoadingScreen } from '@/components/ui/feedback'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Avatar, AvatarGroup } from '@/components/ui/avatar'
import { canWrite, useWorkspace } from '@/hooks/useWorkspace'
import { TaskDialog } from '@/features/board/TaskDialog'
import { AttachmentsTab } from './AttachmentsTab'
import { CommentsTab } from './CommentsTab'
import { HistoryTab } from './HistoryTab'
import { SubtasksTab } from './SubtasksTab'

export function TaskDetailPage(): ReactElement {
  const { taskId } = useParams()
  const workspace = useWorkspace()
  const queryClient = useQueryClient()
  const [editOpen, setEditOpen] = useState(false)
  const [labelDraft, setLabelDraft] = useState('')

  const taskQuery = useQuery({
    queryKey: qk.task(taskId),
    queryFn: () => api.get<{ task: TaskDTO }>(`/tasks/${taskId}`),
  })
  const membersQuery = useQuery({
    queryKey: qk.members(workspace.id),
    queryFn: () => api.get<{ data: MemberDTO[] }>(`/workspaces/${workspace.id}/members`),
  })

  const task = taskQuery.data?.task
  const members = membersQuery.data?.data ?? []
  const writable = canWrite(workspace.role)

  const patch = useMutation({
    mutationFn: (fields: Record<string, unknown>) =>
      api.patch<{ task: TaskDTO }>(`/tasks/${taskId}`, { ...fields, version: task!.version }),
    onSuccess: (payload) => {
      queryClient.setQueryData(qk.task(taskId), payload)
      void queryClient.invalidateQueries({ queryKey: qk.tasksRoot })
      void queryClient.invalidateQueries({ queryKey: qk.projects(workspace.id) })
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') {
        toast.error('This task changed elsewhere — refreshed with the latest version')
      } else {
        toast.error(error instanceof ApiError ? error.message : 'Could not update the task')
      }
      void queryClient.invalidateQueries({ queryKey: qk.task(taskId) })
      void queryClient.invalidateQueries({ queryKey: qk.tasksRoot })
    },
  })

  if (taskQuery.isLoading) return <LoadingScreen label="Loading task…" />
  if (!task) {
    return (
      <EmptyState
        title="Task not found"
        description="It may have been deleted, or you no longer have access."
        action={
          <Button asChild variant="outline">
            <Link to={`/app/${workspace.slug}/projects`}>Back to projects</Link>
          </Button>
        }
      />
    )
  }

  const due = dueDateMeta(task.dueDate)
  const labels = task.labels

  function addLabel(): void {
    const value = labelDraft.trim()
    if (!value || !task) return
    if (labels.includes(value) || labels.length >= 10) {
      setLabelDraft('')
      return
    }
    patch.mutate({ labels: [...labels, value] })
    setLabelDraft('')
  }

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        to={`/app/${workspace.slug}/projects/${task.projectId}`}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {task.projectName || 'Back to board'} · {task.projectKey}
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{task.key}</span>
            <StatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
          </div>
          <h1 className="mt-2 text-2xl font-semibold leading-tight tracking-tight">{task.title}</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Reported by {task.reporter?.name ?? 'Unknown'} · created {formatDate(task.createdAt)}
            {task.completedAt ? ` · completed ${formatDate(task.completedAt)}` : ''}
          </p>
        </div>
        {writable ? (
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil /> Edit
          </Button>
        ) : null}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_260px]">
        {/* Main column */}
        <div className="min-w-0 space-y-6">
          <Card>
            <CardContent className="pt-5">
              <h2 className="text-sm font-semibold">Description</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                {task.description || 'No description yet.'}
              </p>
            </CardContent>
          </Card>

          <Tabs defaultValue="comments">
            <TabsList>
              <TabsTrigger value="comments">
                Comments{task.commentCount ? ` (${task.commentCount})` : ''}
              </TabsTrigger>
              <TabsTrigger value="subtasks">
                Subtasks{task.subtaskCount ? ` (${task.subtaskCount})` : ''}
              </TabsTrigger>
              <TabsTrigger value="files">
                Files{task.attachmentCount ? ` (${task.attachmentCount})` : ''}
              </TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>

            <TabsContent value="comments">
              <CommentsTab taskId={task.id} />
            </TabsContent>
            <TabsContent value="subtasks">
              <SubtasksTab task={task} writable={writable} />
            </TabsContent>
            <TabsContent value="files">
              <AttachmentsTab task={task} writable={writable} />
            </TabsContent>
            <TabsContent value="history">
              <HistoryTab taskId={task.id} />
            </TabsContent>
          </Tabs>
        </div>

        {/* Meta sidebar */}
        <aside className="space-y-4">
          <Card>
            <CardContent className="space-y-4 pt-5">
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Status</p>
                {writable ? (
                  <Select
                    value={task.status}
                    onValueChange={(value) => patch.mutate({ status: value as TaskStatus })}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TASK_STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>
                          {TASK_STATUS_LABELS[status]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <StatusBadge status={task.status} />
                )}
              </div>

              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Priority</p>
                {writable ? (
                  <Select
                    value={task.priority}
                    onValueChange={(value) => patch.mutate({ priority: value as TaskPriority })}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TASK_PRIORITIES.map((priority) => (
                        <SelectItem key={priority} value={priority}>
                          {PRIORITY_LABELS[priority]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <PriorityBadge priority={task.priority} />
                )}
              </div>

              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Assignees</p>
                <div className="flex items-center gap-2">
                  <AvatarGroup people={task.assignees} max={3} />
                  {writable ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
                          Edit
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        {members.map((member) => (
                          <DropdownMenuCheckboxItem
                            key={member.userId}
                            checked={task.assignees.some((a) => a.id === member.userId)}
                            onSelect={(event) => event.preventDefault()}
                            onCheckedChange={(checked) => {
                              const current = task.assignees.map((a) => a.id)
                              const next = checked
                                ? [...current, member.userId]
                                : current.filter((id) => id !== member.userId)
                              patch.mutate({ assigneeIds: next })
                            }}
                          >
                            <Avatar name={member.name} src={member.avatarUrl} seed={member.userId} className="h-5 w-5" />
                            <span className="truncate">{member.name}</span>
                          </DropdownMenuCheckboxItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Due date</p>
                {writable ? (
                  <Input
                    type="date"
                    className="h-8 text-xs"
                    value={task.dueDate ? task.dueDate.slice(0, 10) : ''}
                    onChange={(event) =>
                      patch.mutate({
                        dueDate: event.target.value
                          ? new Date(`${event.target.value}T12:00:00.000Z`).toISOString()
                          : null,
                      })
                    }
                  />
                ) : (
                  <p className={`text-sm ${due.className}`}>{due.label}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  <Tag className="h-3 w-3" /> Labels
                </p>
                <div className="flex flex-wrap gap-1">
                  {labels.map((label) => (
                    <span
                      key={label}
                      className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-foreground"
                    >
                      {label}
                      {writable ? (
                        <button
                          aria-label={`Remove label ${label}`}
                          onClick={() => patch.mutate({ labels: labels.filter((entry) => entry !== label) })}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      ) : null}
                    </span>
                  ))}
                  {labels.length === 0 ? (
                    <span className="text-xs text-muted-foreground">No labels</span>
                  ) : null}
                </div>
                {writable ? (
                  <Input
                    value={labelDraft}
                    className="h-8 text-xs"
                    placeholder="Add label and press Enter"
                    onChange={(event) => setLabelDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        addLabel()
                      }
                    }}
                  />
                ) : null}
              </div>
            </CardContent>
          </Card>

          <p className="px-1 text-[11px] text-muted-foreground">
            Version {task.version} · updated {formatDate(task.updatedAt)}
          </p>
        </aside>
      </div>

      <TaskDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        projectId={task.projectId}
        task={task}
      />
    </div>
  )
}
