import { TASK_STATUSES, type TaskDTO, type TaskStatus } from '@flowforge/shared'

export const COLUMN_DRAG_PREFIX = 'column:'

export const columnDropId = (status: TaskStatus): string => `${COLUMN_DRAG_PREFIX}${status}`

export function byPosition(a: TaskDTO, b: TaskDTO): number {
  return a.position - b.position || a.createdAt.localeCompare(b.createdAt)
}

export function groupByStatus(tasks: TaskDTO[]): Record<TaskStatus, TaskDTO[]> {
  const groups = Object.fromEntries(
    TASK_STATUSES.map((status) => [status, [] as TaskDTO[]]),
  ) as Record<TaskStatus, TaskDTO[]>

  for (const task of tasks) groups[task.status].push(task)
  for (const status of TASK_STATUSES) groups[status].sort(byPosition)
  return groups
}

export interface MoveTarget {
  status: TaskStatus
  position: number
}

/**
 * Pure drag-and-drop resolution: given the full task list and the dragged +
 * dropped ids, work out the target column and a fractional position that sorts
 * between the neighbours. Returns null when the move is a no-op.
 */
export function computeMove(tasks: TaskDTO[], activeId: string, overId: string): MoveTarget | null {
  if (activeId === overId) return null
  const active = tasks.find((task) => task.id === activeId)
  if (!active) return null

  let targetStatus: TaskStatus
  let insertIndex: number

  if (overId.startsWith(COLUMN_DRAG_PREFIX)) {
    targetStatus = overId.slice(COLUMN_DRAG_PREFIX.length) as TaskStatus
    insertIndex = Number.MAX_SAFE_INTEGER
  } else {
    const over = tasks.find((task) => task.id === overId)
    if (!over) return null
    targetStatus = over.status
    const column = groupByStatus(tasks.filter((task) => task.id !== activeId))[targetStatus]
    const overIndex = column.findIndex((task) => task.id === over.id)
    insertIndex = overIndex === -1 ? column.length : overIndex
  }

  const column = groupByStatus(tasks.filter((task) => task.id !== activeId))[targetStatus]
  const index = Math.min(insertIndex, column.length)
  const before = column[index - 1]?.position
  const after = column[index]?.position

  let position: number
  if (before === undefined && after === undefined) position = 0
  else if (before === undefined) position = (after as number) - 1
  else if (after === undefined) position = before + 1
  else position = (before + after) / 2

  if (active.status === targetStatus && active.position === position) return null
  return { status: targetStatus, position }
}
