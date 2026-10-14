import { describe, expect, it } from 'vitest'
import type { TaskDTO } from '@flowforge/shared'
import { computeMove, groupByStatus } from './board-utils'

function task(overrides: Partial<TaskDTO> & Pick<TaskDTO, 'id' | 'status' | 'position'>): TaskDTO {
  return {
    workspaceId: 'ws',
    projectId: 'p1',
    projectKey: 'WEB',
    projectName: 'Web',
    key: `WEB-${overrides.id}`,
    title: `Task ${overrides.id}`,
    description: '',
    priority: 'medium',
    assignees: [],
    reporter: null,
    labels: [],
    dueDate: null,
    startDate: null,
    parentTaskId: null,
    version: 0,
    completedAt: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...overrides,
  }
}

const tasks: TaskDTO[] = [
  task({ id: 't1', status: 'todo', position: 0 }),
  task({ id: 't2', status: 'todo', position: 1 }),
  task({ id: 't3', status: 'in_progress', position: 10 }),
]

describe('groupByStatus', () => {
  it('groups tasks into ordered columns', () => {
    const columns = groupByStatus(tasks)
    expect(columns.todo.map((entry) => entry.id)).toEqual(['t1', 't2'])
    expect(columns.in_progress.map((entry) => entry.id)).toEqual(['t3'])
    expect(columns.done).toEqual([])
  })
})

describe('computeMove', () => {
  it('appends to the end when dropped on an empty area of a column', () => {
    const move = computeMove(tasks, 't1', 'column:in_progress')
    expect(move).toEqual({ status: 'in_progress', position: 11 })
  })

  it('inserts before the hovered task with a fractional position', () => {
    const move = computeMove(tasks, 't3', 't2')
    expect(move).toEqual({ status: 'todo', position: 0.5 })
  })

  it('moves to the very top when dropped on the first task of a column', () => {
    const move = computeMove(tasks, 't3', 't1')
    expect(move).toEqual({ status: 'todo', position: -1 })
  })

  it('reorders within the same column', () => {
    const move = computeMove(tasks, 't2', 't1')
    expect(move).toEqual({ status: 'todo', position: -1 })
  })

  it('returns null for no-op moves', () => {
    expect(computeMove(tasks, 't1', 't2')).toBeNull()
    expect(computeMove(tasks, 't1', 't1')).toBeNull()
  })

  it('returns null when the dragged task or target is unknown', () => {
    expect(computeMove(tasks, 'missing', 't1')).toBeNull()
    expect(computeMove(tasks, 't1', 'missing')).toBeNull()
  })
})
