import type { ReactElement } from 'react'
import type { Role, TaskPriority, TaskStatus } from '@flowforge/shared'
import { PRIORITY_LABELS, ROLE_LABELS, TASK_STATUS_LABELS } from '@flowforge/shared'
import { Badge } from '../ui/badge'
import { cn, priorityStyles, roleStyles, statusAccent, statusStyles } from '@/lib/utils'

/** Status is carried by a dot as well as the label, so colour is never the only signal. */
function Dot({ className }: { className?: string }): ReactElement {
  return <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', className)} />
}

export function StatusBadge({ status }: { status: TaskStatus }): ReactElement {
  return (
    <Badge className={cn(statusStyles[status])}>
      <Dot className={statusAccent[status]} />
      {TASK_STATUS_LABELS[status]}
    </Badge>
  )
}

export function PriorityBadge({ priority }: { priority: TaskPriority }): ReactElement {
  return (
    <Badge className={cn(priorityStyles[priority])}>
      <Dot
        className={cn(
          priority === 'low' && 'bg-status-backlog',
          priority === 'medium' && 'bg-status-todo',
          priority === 'high' && 'bg-status-review',
          priority === 'urgent' && 'bg-destructive',
        )}
      />
      {PRIORITY_LABELS[priority]}
    </Badge>
  )
}

export function RoleBadge({ role }: { role: Role }): ReactElement {
  return <Badge className={cn(roleStyles[role])}>{ROLE_LABELS[role]}</Badge>
}
