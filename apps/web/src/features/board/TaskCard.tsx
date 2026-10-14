import { MessageSquare, Paperclip, ListTree } from 'lucide-react'
import type { CSSProperties, ReactElement } from 'react'
import type { DraggableAttributes } from '@dnd-kit/core'
import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities'
import type { TaskDTO } from '@flowforge/shared'
import { cn, dueDateMeta } from '@/lib/utils'
import { Avatar, AvatarGroup } from '@/components/ui/avatar'
import { PriorityBadge } from '@/components/common/badges'

export interface TaskCardProps {
  task: TaskDTO
  onOpen?: (task: TaskDTO) => void
  style?: CSSProperties
  isDragging?: boolean
  /** Present when rendered inside a sortable context. */
  dragAttributes?: DraggableAttributes
  dragListeners?: SyntheticListenerMap
}

export function TaskCard({
  task,
  onOpen,
  style,
  isDragging,
  dragAttributes,
  dragListeners,
}: TaskCardProps): ReactElement {
  const due = dueDateMeta(task.dueDate)

  return (
    <article
      style={style}
      data-testid={`task-card-${task.key}`}
      {...dragAttributes}
      {...dragListeners}
      onClick={() => onOpen?.(task)}
      className={cn(
        'cursor-pointer rounded-lg border border-border bg-card p-3 shadow-xs transition-shadow hover:shadow-md',
        isDragging && 'cursor-grabbing opacity-60 shadow-lg ring-2 ring-primary/40',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-[11px] text-muted-foreground">{task.key}</span>
        <PriorityBadge priority={task.priority} />
      </div>

      <p className="mt-2 line-clamp-2 text-sm font-medium leading-snug">{task.title}</p>

      {task.labels.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.labels.slice(0, 3).map((label) => (
            <span
              key={label}
              className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground"
            >
              {label}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {(task.subtaskCount ?? 0) > 0 ? (
            <span className="flex items-center gap-0.5">
              <ListTree className="h-3 w-3" /> {task.subtaskCount}
            </span>
          ) : null}
          {(task.commentCount ?? 0) > 0 ? (
            <span className="flex items-center gap-0.5">
              <MessageSquare className="h-3 w-3" /> {task.commentCount}
            </span>
          ) : null}
          {(task.attachmentCount ?? 0) > 0 ? (
            <span className="flex items-center gap-0.5">
              <Paperclip className="h-3 w-3" /> {task.attachmentCount}
            </span>
          ) : null}
          <span className={cn('truncate', due.className)}>{due.label}</span>
        </div>

        {task.assignees.length > 0 ? (
          <AvatarGroup people={task.assignees} max={3} />
        ) : (
          <Avatar name="Unassigned" seed="unassigned" className="h-6 w-6 opacity-40" />
        )}
      </div>
    </article>
  )
}
