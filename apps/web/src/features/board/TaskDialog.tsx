import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, Tags, UserPlus } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactElement } from 'react'
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
import { toast } from 'sonner'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useWorkspace } from '@/hooks/useWorkspace'

interface TaskDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  task?: TaskDTO | null
  defaultStatus?: TaskStatus
  onDeleted?: () => void
}

function TaskDialogForm({
  projectId,
  task,
  defaultStatus,
  onClose,
  onDeleted,
}: {
  projectId: string
  task?: TaskDTO | null
  defaultStatus?: TaskStatus
  onClose: () => void
  onDeleted?: () => void
}): ReactElement {
  const workspace = useWorkspace()
  const queryClient = useQueryClient()

  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? defaultStatus ?? 'todo')
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 'medium')
  const [assigneeIds, setAssigneeIds] = useState<string[]>(task?.assignees.map((a) => a.id) ?? [])
  const [labelsText, setLabelsText] = useState((task?.labels ?? []).join(', '))
  const [dueDate, setDueDate] = useState(task?.dueDate ? task.dueDate.slice(0, 10) : '')
  const [error, setError] = useState<string | null>(null)

  // Board payloads omit descriptions (payload size). Hydrate the full task before
  // editing so saving can never wipe a description the list never carried.
  const needsDescription = Boolean(task) && task?.description === undefined
  const detailQuery = useQuery({
    queryKey: qk.task(task?.id),
    queryFn: () => api.get<{ task: TaskDTO }>(`/tasks/${task!.id}`),
    enabled: needsDescription,
  })
  useEffect(() => {
    const hydrated = detailQuery.data?.task
    if (hydrated?.description !== undefined) setDescription(hydrated.description)
  }, [detailQuery.data])
  const descriptionReady = !needsDescription || Boolean(detailQuery.data)

  const membersQuery = useQuery({
    queryKey: qk.members(workspace.id),
    queryFn: () => api.get<{ data: MemberDTO[] }>(`/workspaces/${workspace.id}/members`),
  })
  const members = membersQuery.data?.data ?? []

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        title: title.trim(),
        description,
        status,
        priority,
        assigneeIds,
        labels: labelsText
          .split(',')
          .map((label) => label.trim())
          .filter(Boolean)
          .slice(0, 10),
        dueDate: dueDate ? new Date(`${dueDate}T12:00:00.000Z`).toISOString() : null,
      }
      if (task)
        return api.patch<{ task: TaskDTO }>(`/tasks/${task.id}`, {
          ...payload,
          version: task.version,
        })
      return api.post<{ task: TaskDTO }>(`/projects/${projectId}/tasks`, payload)
    },
    onSuccess: (payload) => {
      toast.success(task ? `${payload.task.key} updated` : `${payload.task.key} created`)
      void queryClient.invalidateQueries({ queryKey: qk.tasksRoot })
      void queryClient.invalidateQueries({ queryKey: qk.task(payload.task.id) })
      void queryClient.invalidateQueries({ queryKey: qk.projects(workspace.id) })
      onClose()
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') {
        setError(
          'This task changed while you were editing — close and reopen to see the latest version.',
        )
        void queryClient.invalidateQueries({ queryKey: qk.task(task?.id) })
        void queryClient.invalidateQueries({ queryKey: qk.tasksRoot })
        return
      }
      setError(err instanceof ApiError ? err.message : 'Could not save the task')
    },
  })

  const remove = useMutation({
    mutationFn: () => api.del(`/tasks/${task!.id}`),
    onSuccess: () => {
      toast.success('Task deleted')
      void queryClient.invalidateQueries({ queryKey: qk.tasksRoot })
      onClose()
      onDeleted?.()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not delete the task'),
  })

  function onSubmit(event: FormEvent): void {
    event.preventDefault()
    setError(null)
    if (title.trim().length === 0) {
      setError('Give the task a title')
      return
    }
    save.mutate()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="task-title">Title</Label>
        <Input
          id="task-title"
          value={title}
          autoFocus
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Write the release notes"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="task-description">Description</Label>
        <Textarea
          id="task-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Add context, acceptance criteria or links"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Status</Label>
          <Select value={status} onValueChange={(value) => setStatus(value as TaskStatus)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TASK_STATUSES.map((entry) => (
                <SelectItem key={entry} value={entry}>
                  {TASK_STATUS_LABELS[entry]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Priority</Label>
          <Select value={priority} onValueChange={(value) => setPriority(value as TaskPriority)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TASK_PRIORITIES.map((entry) => (
                <SelectItem key={entry} value={entry}>
                  {PRIORITY_LABELS[entry]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5">
            <UserPlus className="h-3.5 w-3.5" /> Assignees
          </Label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-full justify-start font-normal">
                {assigneeIds.length === 0
                  ? 'Unassigned'
                  : `${assigneeIds.length} member${assigneeIds.length === 1 ? '' : 's'}`}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              {members.map((member) => (
                <DropdownMenuCheckboxItem
                  key={member.userId}
                  checked={assigneeIds.includes(member.userId)}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(checked) =>
                    setAssigneeIds((current) =>
                      checked
                        ? [...current, member.userId]
                        : current.filter((id) => id !== member.userId),
                    )
                  }
                >
                  <Avatar
                    name={member.name}
                    src={member.avatarUrl}
                    seed={member.userId}
                    className="h-5 w-5"
                  />
                  <span className="truncate">{member.name}</span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="task-due" className="flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5" /> Due date
          </Label>
          <Input
            id="task-due"
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="task-labels" className="flex items-center gap-1.5">
          <Tags className="h-3.5 w-3.5" /> Labels
        </Label>
        <Input
          id="task-labels"
          value={labelsText}
          onChange={(event) => setLabelsText(event.target.value)}
          placeholder="frontend, bug, ux"
        />
        <p className="text-xs text-muted-foreground">Comma-separated, up to 10 labels.</p>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-2 pt-2">
        {task ? (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            Delete task
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending || !descriptionReady}>
            {save.isPending
              ? 'Saving…'
              : !descriptionReady
                ? 'Loading…'
                : task
                  ? 'Save changes'
                  : 'Create task'}
          </Button>
        </div>
      </div>
    </form>
  )
}

export function TaskDialog({
  open,
  onOpenChange,
  projectId,
  task,
  defaultStatus,
  onDeleted,
}: TaskDialogProps): ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{task ? `${task.key} · Edit task` : 'New task'}</DialogTitle>
          <DialogDescription>
            {task
              ? 'Updates are version-checked — if someone else edits first, you will be asked to refresh.'
              : 'Tasks appear instantly on the board for everyone in this workspace.'}
          </DialogDescription>
        </DialogHeader>
        {/* Keyed so form state resets whenever a different task is opened. */}
        <TaskDialogForm
          key={task?.id ?? `new-${defaultStatus ?? 'todo'}-${open}`}
          projectId={projectId}
          task={task}
          defaultStatus={defaultStatus}
          onClose={() => onOpenChange(false)}
          onDeleted={onDeleted}
        />
      </DialogContent>
    </Dialog>
  )
}
