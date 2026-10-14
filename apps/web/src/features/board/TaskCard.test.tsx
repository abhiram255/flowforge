import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { TaskDTO } from '@flowforge/shared'
import { TaskCard } from './TaskCard'

const task: TaskDTO = {
  id: '507f1f77bcf86cd799439012',
  workspaceId: '507f1f77bcf86cd799439010',
  projectId: '507f1f77bcf86cd799439011',
  projectKey: 'WEB',
  projectName: 'Website Redesign',
  key: 'WEB-7',
  title: 'Ship the analytics page',
  description: 'With charts',
  status: 'in_progress',
  priority: 'urgent',
  assignees: [
    { id: '507f1f77bcf86cd799439013', name: 'Priya Sharma', avatarUrl: null },
    { id: '507f1f77bcf86cd799439014', name: 'Rohan Gupta', avatarUrl: null },
  ],
  reporter: null,
  labels: ['frontend', 'analytics'],
  dueDate: new Date(Date.now() - 86_400_000).toISOString(),
  startDate: null,
  parentTaskId: null,
  subtaskCount: 2,
  commentCount: 3,
  attachmentCount: 1,
  position: 1,
  version: 4,
  completedAt: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
}

describe('TaskCard', () => {
  it('renders the key, title, priority, labels and counts', () => {
    render(<TaskCard task={task} />)

    expect(screen.getByText('WEB-7')).toBeInTheDocument()
    expect(screen.getByText('Ship the analytics page')).toBeInTheDocument()
    expect(screen.getByText('Urgent')).toBeInTheDocument()
    expect(screen.getByText('frontend')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('flags overdue due dates', () => {
    render(<TaskCard task={task} />)
    expect(screen.getByText(/Overdue/)).toBeInTheDocument()
  })

  it('handles tasks without assignees or labels', () => {
    render(<TaskCard task={{ ...task, assignees: [], labels: [], dueDate: null }} />)
    expect(screen.getByText('No due date')).toBeInTheDocument()
  })

  it('invokes onOpen when clicked', async () => {
    let opened: TaskDTO | null = null
    render(<TaskCard task={task} onOpen={(entry) => (opened = entry)} />)
    screen.getByText('Ship the analytics page').click()
    expect(opened).not.toBeNull()
  })
})
