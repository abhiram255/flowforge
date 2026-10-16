import type { ReactElement } from 'react'
import { cn } from '@/lib/utils'

/**
 * The FlowForge plate: an ember panel with a cut corner, echoing the favicon.
 * Colours come from CSS custom properties so the mark tracks the active theme.
 */
export function BrandMark({
  className,
  showName = false,
}: {
  className?: string
  showName?: boolean
}): ReactElement {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <svg viewBox="0 0 32 32" aria-hidden className="h-7 w-7 shrink-0">
        <path d="M0 0h32v20l-12 12H0z" style={{ fill: 'var(--primary)' }} />
        <g style={{ stroke: 'var(--background)' }} strokeWidth={2.6} strokeLinecap="round">
          <path d="M8 11h16M8 16h11M8 21h6" />
        </g>
      </svg>
      {showName ? (
        <span className="text-sm font-semibold tracking-tight">
          Flow<span className="text-primary">Forge</span>
        </span>
      ) : null}
    </span>
  )
}
