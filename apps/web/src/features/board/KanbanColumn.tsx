import { useDroppable } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus } from 'lucide-react'
import type { ReactElement } from 'react'
import { TASK_STATUS_LABELS, type TaskDTO, type TaskStatus } from '@flowforge/shared'
import { cn, statusAccent } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { TaskCard } from './TaskCard'
import { columnDropId } from './board-utils'

function SortableTaskCard({
  task,
  onOpen,
}: {
  task: TaskDTO
  onOpen: (task: TaskDTO) => void
}): ReactElement {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && 'z-10')}
    >
      <TaskCard
        task={task}
        onOpen={onOpen}
        isDragging={isDragging}
        dragAttributes={attributes}
        dragListeners={listeners}
      />
    </div>
  )
}

export function KanbanColumn({
  status,
  tasks,
  onOpenTask,
  onAddTask,
  canWrite,
}: {
  status: TaskStatus
  tasks: TaskDTO[]
  onOpenTask: (task: TaskDTO) => void
  onAddTask: (status: TaskStatus) => void
  canWrite: boolean
}): ReactElement {
  const { setNodeRef, isOver } = useDroppable({ id: columnDropId(status) })

  return (
    <section
      className={cn(
        'ff-panel flex w-[292px] shrink-0 flex-col overflow-hidden rounded-lg',
        isOver && 'border-primary/50 shadow-glow',
      )}
      data-testid={`column-${status}`}
    >
      <span aria-hidden className={cn('h-[2px] w-full', statusAccent[status])} />

      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className={cn('h-1.5 w-1.5 shrink-0 rounded-full', statusAccent[status])}
          />
          <h3 className="ff-label truncate text-foreground">{TASK_STATUS_LABELS[status]}</h3>
          <span className="ff-num rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">
            {tasks.length}
          </span>
        </div>
        {canWrite ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 ff-tap"
            onClick={() => onAddTask(status)}
            aria-label={`Add task to ${TASK_STATUS_LABELS[status]}`}
          >
            <Plus className="h-4 w-4" />
          </Button>
        ) : null}
      </header>

      <div ref={setNodeRef} className="scrollbar-thin flex-1 space-y-2 overflow-y-auto p-2">
        <SortableContext
          items={tasks.map((task) => task.id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((task) => (
            <SortableTaskCard key={task.id} task={task} onOpen={onOpenTask} />
          ))}
        </SortableContext>

        {tasks.length === 0 ? (
          <p className="ff-label rounded-md border border-dashed border-border-strong/70 px-3 py-7 text-center text-muted-foreground/70">
            Drop zone
          </p>
        ) : null}
      </div>
    </section>
  )
}
