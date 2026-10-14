import type { ReactElement } from 'react'
import type { Role, TaskPriority, TaskStatus } from '@flowforge/shared'
import {
  PRIORITY_LABELS,
  ROLE_LABELS,
  TASK_STATUS_LABELS,
} from '@flowforge/shared'
import { Badge } from '../ui/badge'
import { cn, priorityStyles, roleStyles, statusStyles } from '@/lib/utils'

export function StatusBadge({ status }: { status: TaskStatus }): ReactElement {
  return <Badge className={cn(statusStyles[status])}>{TASK_STATUS_LABELS[status]}</Badge>
}

export function PriorityBadge({ priority }: { priority: TaskPriority }): ReactElement {
  return <Badge className={cn(priorityStyles[priority])}>{PRIORITY_LABELS[priority]}</Badge>
}

export function RoleBadge({ role }: { role: Role }): ReactElement {
  return <Badge className={cn(roleStyles[role])}>{ROLE_LABELS[role]}</Badge>
}
