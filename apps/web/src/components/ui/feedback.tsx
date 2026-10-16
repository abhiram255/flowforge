import type { ReactElement } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): ReactElement {
  return <div className={cn('ff-skeleton rounded-md', className)} {...props} />
}

export function Spinner({ className }: { className?: string }): ReactElement {
  return <Loader2 className={cn('h-4 w-4 animate-spin text-primary', className)} />
}

export function LoadingScreen({ label = 'Loading…' }: { label?: string }): ReactElement {
  return (
    <div className="flex h-full min-h-[40vh] flex-col items-center justify-center gap-3">
      <Spinner className="h-5 w-5" />
      <p className="ff-label text-muted-foreground">{label}</p>
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactElement
  title: string
  description?: string
  action?: ReactElement
  className?: string
}): ReactElement {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border-strong bg-surface-1/40 px-6 py-12 text-center',
        className,
      )}
    >
      {icon ? (
        <div className="flex h-11 w-11 items-center justify-center rounded-md border border-border bg-surface-2 text-muted-foreground">
          {icon}
        </div>
      ) : null}
      <p className="text-sm font-medium tracking-tight">{title}</p>
      {description ? (
        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}
