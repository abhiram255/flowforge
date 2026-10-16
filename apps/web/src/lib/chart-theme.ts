import { useEffect, useState } from 'react'
import type { TaskStatus } from '@flowforge/shared'

/**
 * Chart colours are read from the design tokens so the charts follow the active
 * theme, and so the values handed to SVG attributes are real computed colours
 * (`fill="var(--x)"` never resolves as a presentation attribute).
 */
export interface ChartTheme {
  accent: string
  cool: string
  success: string
  warning: string
  danger: string
  muted: string
  grid: string
  surface: string
  border: string
  status: Record<TaskStatus, string>
}

function token(name: string): string {
  if (typeof document === 'undefined') return 'currentColor'
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || 'currentColor'
}

export function readChartTheme(): ChartTheme {
  return {
    accent: token('--primary'),
    cool: token('--status-todo'),
    success: token('--success'),
    warning: token('--warning'),
    danger: token('--destructive'),
    muted: token('--muted-foreground'),
    grid: token('--border'),
    surface: token('--surface-1'),
    border: token('--border-strong'),
    status: {
      backlog: token('--status-backlog'),
      todo: token('--status-todo'),
      in_progress: token('--status-progress'),
      in_review: token('--status-review'),
      done: token('--status-done'),
    },
  }
}

export function useChartTheme(): ChartTheme {
  const [theme, setTheme] = useState<ChartTheme>(readChartTheme)

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(readChartTheme()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return theme
}
