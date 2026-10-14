import type { ReactElement } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): ReactElement {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />
}

export function Spinner({ className }: { className?: string }): ReactElement {
  return <Loader2 className={cn('h-4 w-4 animate-spin text-muted-foreground', className)} />
}

export function LoadingScreen({ label = 'Loading…' }: { label?: string }): ReactElement {
  return (
    <div className="flex h-full min-h-[40vh] flex-col items-center justify-center gap-3">
      <Spinner className="h-6 w-6" />
      <p className="text-sm text-muted-foreground">{label}</p>
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
        'flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-6 py-12 text-center',
        className,
      )}
    >
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}
