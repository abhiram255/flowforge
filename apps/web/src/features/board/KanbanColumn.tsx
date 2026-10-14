import { useDroppable } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus } from 'lucide-react'
import type { ReactElement } from 'react'
import { TASK_STATUS_LABELS, type TaskDTO, type TaskStatus } from '@flowforge/shared'
import { cn } from '@/lib/utils'
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
        'flex w-[290px] shrink-0 flex-col rounded-xl border border-border bg-muted/40',
        isOver && 'ring-2 ring-primary/40',
      )}
      data-testid={`column-${status}`}
    >
      <header className="flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">{TASK_STATUS_LABELS[status]}</h3>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {tasks.length}
          </span>
        </div>
        {canWrite ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => onAddTask(status)}
            aria-label={`Add task to ${TASK_STATUS_LABELS[status]}`}
          >
            <Plus className="h-4 w-4" />
          </Button>
        ) : null}
      </header>

      <div ref={setNodeRef} className="scrollbar-thin flex-1 space-y-2 overflow-y-auto px-2 pb-3">
        <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <SortableTaskCard key={task.id} task={task} onOpen={onOpenTask} />
          ))}
        </SortableContext>

        {tasks.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
            Drop tasks here
          </p>
        ) : null}
      </div>
    </section>
  )
}
