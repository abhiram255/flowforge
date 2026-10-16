import type { ReactElement, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}): ReactElement {
  return (
    <div className={cn('mb-6', className)}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="ff-label mb-2.5 flex items-center gap-2 text-muted-foreground">
              <span aria-hidden className="h-3 w-[2px] rounded-full bg-primary" />
              {eyebrow}
            </p>
          ) : null}
          <h1 className="text-xl font-semibold tracking-[-0.02em]">{title}</h1>
          {description ? (
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className="ff-hair mt-5" />
    </div>
  )
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: ReactNode
  hint?: string
  tone?: 'default' | 'danger' | 'success'
}): ReactElement {
  return (
    <div
      className={cn(
        'ff-panel rounded-lg border-l-2 p-4',
        tone === 'default' && 'border-l-border-strong',
        tone === 'danger' && 'border-l-destructive',
        tone === 'success' && 'border-l-success',
      )}
    >
      <p className="ff-label text-muted-foreground">{label}</p>
      <p
        className={cn(
          'ff-num mt-2.5 text-[26px] font-semibold leading-none',
          tone === 'danger' && 'text-destructive',
          tone === 'success' && 'text-success',
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-2 text-[11px] leading-tight text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
