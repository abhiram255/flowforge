import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { Role, TaskPriority, TaskStatus } from '@flowforge/shared'

export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs))

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || '?'
}

/** Deterministic avatar tint derived from the user id — no image hosting needed. */
export function avatarGradient(seed: string): string {
  const palettes = [
    'from-[oklch(0.55_0.11_58)] to-[oklch(0.45_0.09_28)]',
    'from-[oklch(0.52_0.08_215)] to-[oklch(0.44_0.07_255)]',
    'from-[oklch(0.52_0.09_158)] to-[oklch(0.44_0.07_182)]',
    'from-[oklch(0.55_0.09_95)] to-[oklch(0.45_0.07_68)]',
    'from-[oklch(0.5_0.09_330)] to-[oklch(0.42_0.08_300)]',
    'from-[oklch(0.54_0.08_22)] to-[oklch(0.44_0.09_352)]',
  ]
  let hash = 0
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) % 997
  return palettes[hash % palettes.length] as string
}

export const statusStyles: Record<TaskStatus, string> = {
  backlog: 'border-status-backlog/30 bg-status-backlog/10 text-status-backlog',
  todo: 'border-status-todo/30 bg-status-todo/10 text-status-todo',
  in_progress: 'border-status-progress/35 bg-status-progress/12 text-status-progress',
  in_review: 'border-status-review/35 bg-status-review/12 text-status-review',
  done: 'border-status-done/30 bg-status-done/12 text-status-done',
}

export const statusAccent: Record<TaskStatus, string> = {
  backlog: 'bg-status-backlog',
  todo: 'bg-status-todo',
  in_progress: 'bg-status-progress',
  in_review: 'bg-status-review',
  done: 'bg-status-done',
}

export const priorityStyles: Record<TaskPriority, string> = {
  low: 'border-status-backlog/30 bg-status-backlog/10 text-status-backlog',
  medium: 'border-status-todo/30 bg-status-todo/10 text-status-todo',
  high: 'border-status-review/35 bg-status-review/12 text-status-review',
  urgent: 'border-destructive/35 bg-destructive/12 text-destructive',
}

export const roleStyles: Record<Role, string> = {
  owner: 'border-status-progress/35 bg-status-progress/12 text-status-progress',
  admin: 'border-status-todo/30 bg-status-todo/10 text-status-todo',
  member: 'border-status-done/30 bg-status-done/12 text-status-done',
  viewer: 'border-status-backlog/30 bg-status-backlog/10 text-status-backlog',
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  const diffMs = Date.now() - date.getTime()
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return formatDate(date)
}

export function dueDateMeta(value: string | null | undefined): {
  label: string
  className: string
} {
  if (!value) return { label: 'No due date', className: 'text-muted-foreground' }
  const due = new Date(value)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfDue = new Date(due.getFullYear(), due.getMonth(), due.getDate())
  const diffDays = Math.round((startOfDue.getTime() - startOfToday.getTime()) / 86_400_000)

  if (diffDays < 0) return { label: `Overdue · ${formatDate(due)}`, className: 'text-destructive' }
  if (diffDays === 0) return { label: 'Due today', className: 'text-warning' }
  if (diffDays === 1) return { label: 'Due tomorrow', className: 'text-warning' }
  if (diffDays <= 7) return { label: `Due ${formatDate(due)}`, className: 'text-foreground' }
  return { label: formatDate(due), className: 'text-muted-foreground' }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
