import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Circle, Plus } from 'lucide-react'
import { useState, type FormEvent, type ReactElement } from 'react'
import { Link } from 'react-router-dom'
import type { TaskDTO } from '@flowforge/shared'
import api, { ApiError } from '@/lib/api'
import { qk } from '@/lib/query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/feedback'
import { useWorkspace } from '@/hooks/useWorkspace'

export function SubtasksTab({
  task,
  writable,
}: {
  task: TaskDTO
  writable: boolean
}): ReactElement {
  const workspace = useWorkspace()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')

  const query = useQuery({
    queryKey: qk.subtasks(task.id),
    queryFn: () => api.get<{ data: TaskDTO[] }>(`/tasks/${task.id}/subtasks`),
  })

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: qk.subtasks(task.id) })
    void queryClient.invalidateQueries({ queryKey: qk.task(task.id) })
    void queryClient.invalidateQueries({ queryKey: qk.tasksRoot })
  }

  const create = useMutation({
    mutationFn: () =>
      api.post(`/projects/${task.projectId}/tasks`, {
        title: title.trim(),
        parentTaskId: task.id,
      }),
    onSuccess: () => {
      setTitle('')
      invalidate()
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not add the subtask'),
  })

  const toggle = useMutation({
    mutationFn: (subtask: TaskDTO) =>
      api.patch(`/tasks/${subtask.id}`, {
        status: subtask.status === 'done' ? 'todo' : 'done',
        version: subtask.version,
      }),
    onSuccess: invalidate,
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : 'Could not update the subtask')
      invalidate()
    },
  })

  const subtasks = query.data?.data ?? []
  const done = subtasks.filter((entry) => entry.status === 'done').length

  function onSubmit(event: FormEvent): void {
    event.preventDefault()
    if (title.trim().length === 0) return
    create.mutate()
  }

  return (
    <div className="space-y-4">
      {subtasks.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {done}/{subtasks.length} complete
        </p>
      ) : null}

      <div className="space-y-1">
        {subtasks.map((subtask) => (
          <div
            key={subtask.id}
            className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/60"
          >
            <button
              disabled={!writable || toggle.isPending}
              onClick={() => toggle.mutate(subtask)}
              aria-label={subtask.status === 'done' ? 'Mark as not done' : 'Mark as done'}
              className="text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {subtask.status === 'done' ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              ) : (
                <Circle className="h-4 w-4" />
              )}
            </button>
            <Link
              to={`/app/${workspace.slug}/tasks/${subtask.id}`}
              className={
                'flex-1 truncate text-sm ' +
                (subtask.status === 'done' ? 'text-muted-foreground line-through' : '')
              }
            >
              {subtask.title}
            </Link>
            <span className="font-mono text-[11px] text-muted-foreground">{subtask.key}</span>
          </div>
        ))}
      </div>

      {query.isLoading ? <Spinner /> : null}

      {writable ? (
        <form onSubmit={onSubmit} className="flex gap-2">
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Add a subtask…"
          />
          <Button type="submit" size="sm" disabled={create.isPending || title.trim().length === 0}>
            <Plus /> Add
          </Button>
        </form>
      ) : null}
    </div>
  )
}
