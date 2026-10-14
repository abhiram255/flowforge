import {
  DndContext,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Filter, Plus, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  PRIORITY_LABELS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type MemberDTO,
  type Paginated,
  type ProjectDTO,
  type TaskDTO,
  type TaskPriority,
  type TaskStatus,
} from '@flowforge/shared'
import api, { ApiError } from '@/lib/api'
import { qk } from '@/lib/query'
import { getSocket } from '@/lib/socket'
import { toast } from 'sonner'
import { AvatarGroup } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { EmptyState, LoadingScreen } from '@/components/ui/feedback'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { canWrite, useWorkspace } from '@/hooks/useWorkspace'
import { useRealtimeStore } from '@/stores/realtime'
import { KanbanColumn } from './KanbanColumn'
import { TaskDialog } from './TaskDialog'
import { computeMove, groupByStatus } from './board-utils'

interface BoardFilters {
  assigneeId?: string
  priority?: TaskPriority
  q?: string
}

function buildQuery(filters: BoardFilters): string {
  const params = new URLSearchParams({ sort: 'position' })
  if (filters.assigneeId) params.set('assigneeId', filters.assigneeId)
  if (filters.priority) params.set('priority', filters.priority)
  if (filters.q) params.set('q', filters.q)
  return params.toString()
}

export function BoardPage(): ReactElement {
  const { projectId } = useParams()
  const workspace = useWorkspace()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [filters, setFilters] = useState<BoardFilters>({})
  const [search, setSearch] = useState('')
  const [dialog, setDialog] = useState<{
    open: boolean
    task: TaskDTO | null
    defaultStatus?: TaskStatus
  }>({ open: false, task: null })

  const projectQuery = useQuery({
    queryKey: qk.project(projectId),
    queryFn: () => api.get<{ project: ProjectDTO }>(`/projects/${projectId}`),
  })

  const tasksKey = qk.tasks({ scope: 'board', projectId, ...filters })
  const tasksQuery = useQuery({
    queryKey: tasksKey,
    queryFn: () =>
      api.get<Paginated<TaskDTO>>(`/projects/${projectId}/tasks?${buildQuery(filters)}`),
  })

  const membersQuery = useQuery({
    queryKey: qk.members(workspace.id),
    queryFn: () => api.get<{ data: MemberDTO[] }>(`/workspaces/${workspace.id}/members`),
  })

  const members = membersQuery.data?.data ?? []
  const tasks = useMemo(() => tasksQuery.data?.data ?? [], [tasksQuery.data])
  const columns = useMemo(() => groupByStatus(tasks), [tasks])

  // Presence: announce this board, and show who else is looking at it.
  useEffect(() => {
    const socket = getSocket()
    if (!socket || !projectId) return
    const join = (): void => {
      socket.emit('project:join', { projectId }, () => undefined)
    }
    if (socket.connected) join()
    else socket.on('connect', join)
    return () => {
      socket.off('connect', join)
    }
  }, [projectId])

  const viewers = useRealtimeStore((state) => (projectId ? state.projectViewers[projectId] : undefined)) ?? []
  const viewerPeople = viewers
    .map((id) => members.find((member) => member.userId === id))
    .filter((member): member is MemberDTO => Boolean(member))

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const moveTask = useMutation({
    mutationFn: (vars: { task: TaskDTO; status: TaskStatus; position: number }) =>
      api.patch(`/tasks/${vars.task.id}`, {
        status: vars.status,
        position: vars.position,
        version: vars.task.version,
      }),
    onError: (error, vars) => {
      if (error instanceof ApiError && error.code === 'VERSION_CONFLICT') {
        toast.error('Someone else changed this task — the board was refreshed')
      } else {
        toast.error(error instanceof ApiError ? error.message : 'Could not move the task')
      }
      void queryClient.invalidateQueries({ queryKey: qk.tasksRoot })
      void queryClient.invalidateQueries({ queryKey: qk.task(vars.task.id) })
    },
  })

  function onDragStart(_event: DragStartEvent): void {
    // Hook point for a drag overlay if we add one later.
  }

  function onDragEnd(event: DragEndEvent): void {
    const { active, over } = event
    if (!over) return

    const move = computeMove(tasks, String(active.id), String(over.id))
    if (!move) return
    const task = tasks.find((entry) => entry.id === String(active.id))
    if (!task) return

    // Optimistic board update; the server event will confirm with a new version.
    queryClient.setQueryData<Paginated<TaskDTO>>(tasksKey, (old) =>
      old
        ? {
            ...old,
            data: old.data.map((entry) =>
              entry.id === task.id ? { ...entry, status: move.status, position: move.position } : entry,
            ),
          }
        : old,
    )
    moveTask.mutate({ task, status: move.status, position: move.position })
  }

  if (projectQuery.isLoading || tasksQuery.isLoading) {
    return <LoadingScreen label="Loading board…" />
  }
  if (!projectQuery.data) {
    return <EmptyState title="Project not found" description="It may have been deleted or archived." />
  }

  const project = projectQuery.data.project
  const writable = canWrite(workspace.role)
  const hasFilters = Boolean(filters.assigneeId || filters.priority || filters.q)

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Board header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Link to={`/app/${workspace.slug}/projects`} className="hover:underline">
              Projects
            </Link>
            <span>/</span>
            <span className="font-mono">{project.key}</span>
          </div>
          <h1 className="mt-1 truncate text-xl font-semibold tracking-tight">{project.name}</h1>
        </div>

        <div className="flex items-center gap-2">
          {viewerPeople.length > 0 ? (
            <div className="hidden items-center gap-2 rounded-lg border border-border px-2 py-1 sm:flex">
              <AvatarGroup people={viewerPeople.map((m) => ({ id: m.userId, name: m.name, avatarUrl: m.avatarUrl }))} max={4} />
              <span className="text-xs text-muted-foreground">viewing</span>
            </div>
          ) : null}
          {writable ? (
            <Button size="sm" onClick={() => setDialog({ open: true, task: null })}>
              <Plus /> New task
            </Button>
          ) : null}
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form
          className="relative"
          onSubmit={(event) => {
            event.preventDefault()
            setFilters((current) => ({ ...current, q: search.trim() || undefined }))
          }}
        >
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search tasks…"
            className="w-56 pl-8"
          />
        </form>

        <Select
          value={filters.assigneeId ?? 'all'}
          onValueChange={(value) =>
            setFilters((current) => ({ ...current, assigneeId: value === 'all' ? undefined : value }))
          }
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Assignee" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All assignees</SelectItem>
            {members.map((member) => (
              <SelectItem key={member.userId} value={member.userId}>
                {member.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.priority ?? 'all'}
          onValueChange={(value) =>
            setFilters((current) => ({
              ...current,
              priority: value === 'all' ? undefined : (value as TaskPriority),
            }))
          }
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priorities</SelectItem>
            {TASK_PRIORITIES.map((priority) => (
              <SelectItem key={priority} value={priority}>
                {PRIORITY_LABELS[priority]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFilters({})
              setSearch('')
            }}
          >
            <X /> Clear
          </Button>
        ) : (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Filter className="h-3.5 w-3.5" /> {tasks.length} tasks
          </span>
        )}
      </div>

      {/* Board */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <div className="scrollbar-thin flex flex-1 gap-4 overflow-x-auto pb-4">
          {TASK_STATUSES.map((status) => (
            <KanbanColumn
              key={status}
              status={status}
              tasks={columns[status]}
              canWrite={writable}
              onOpenTask={(task) => navigate(`/app/${workspace.slug}/tasks/${task.id}`)}
              onAddTask={(columnStatus) =>
                setDialog({ open: true, task: null, defaultStatus: columnStatus })
              }
            />
          ))}
        </div>
      </DndContext>

      {tasks.length === 0 && !hasFilters ? (
        <p className="pb-2 text-center text-xs text-muted-foreground">
          Board is empty — create the first task{writable ? ' with the New task button' : ''}.
        </p>
      ) : null}

      <TaskDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((current) => ({ ...current, open }))}
        projectId={projectId as string}
        task={dialog.task}
        defaultStatus={dialog.defaultStatus}
        onDeleted={() => navigate(`/app/${workspace.slug}/projects/${projectId}`)}
      />
    </div>
  )
}
