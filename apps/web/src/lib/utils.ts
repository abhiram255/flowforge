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
    'from-violet-500 to-fuchsia-500',
    'from-sky-500 to-indigo-500',
    'from-emerald-500 to-teal-500',
    'from-amber-500 to-orange-500',
    'from-rose-500 to-pink-500',
    'from-cyan-500 to-blue-500',
  ]
  let hash = 0
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) % 997
  return palettes[hash % palettes.length] as string
}

export const statusStyles: Record<TaskStatus, string> = {
  backlog: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-300 border-zinc-500/25',
  todo: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/25',
  in_progress: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/25',
  in_review: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/25',
  done: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/25',
}

export const priorityStyles: Record<TaskPriority, string> = {
  low: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-300 border-zinc-500/25',
  medium: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/25',
  high: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/25',
  urgent: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/25',
}

export const roleStyles: Record<Role, string> = {
  owner: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30',
  admin: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
  member: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  viewer: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-300 border-zinc-500/30',
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

  if (diffDays < 0) return { label: `Overdue · ${formatDate(due)}`, className: 'text-rose-500' }
  if (diffDays === 0) return { label: 'Due today', className: 'text-amber-500' }
  if (diffDays === 1) return { label: 'Due tomorrow', className: 'text-amber-500' }
  if (diffDays <= 7) return { label: `Due ${formatDate(due)}`, className: 'text-foreground' }
  return { label: formatDate(due), className: 'text-muted-foreground' }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
