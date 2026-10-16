import type { ReactElement, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Zap } from 'lucide-react'
import { BrandMark } from '@/components/common/BrandMark'

const HIGHLIGHTS = [
  'Multi-tenant workspaces with role-based access control',
  'Real-time Kanban boards with conflict-safe task updates',
  'Analytics, activity history and workload insight',
]

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle: string
  children: ReactNode
  footer: ReactNode
}): ReactElement {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Instrument column */}
      <div className="relative hidden flex-col justify-between overflow-hidden border-r border-border bg-sidebar/50 p-10 lg:flex">
        <Link to="/" className="relative z-10">
          <BrandMark showName />
        </Link>

        <div className="relative z-10 max-w-md">
          <p className="ff-label flex items-center gap-2 text-muted-foreground">
            <span aria-hidden className="h-3 w-[2px] rounded-full bg-primary" />
            Realtime delivery platform
          </p>
          <h2 className="mt-4 text-3xl font-semibold leading-tight tracking-[-0.03em]">
            Ship projects, not status updates.
          </h2>
          <p className="mt-3.5 text-sm leading-relaxed text-muted-foreground">
            FlowForge keeps your team aligned with live boards, task-level discussion and measurable
            delivery analytics.
          </p>
          <ol className="mt-8 space-y-4">
            {HIGHLIGHTS.map((item, index) => (
              <li key={item} className="flex items-start gap-3.5">
                <span className="ff-num mt-0.5 shrink-0 text-[10px] font-semibold text-primary">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="text-sm leading-relaxed text-muted-foreground">{item}</span>
              </li>
            ))}
          </ol>
        </div>

        <p className="ff-label relative z-10 flex items-center gap-2 text-muted-foreground">
          <Zap className="h-3.5 w-3.5 text-primary" />
          Socket.IO realtime · MongoDB · Redis-ready
        </p>
      </div>

      {/* Form column */}
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-9 lg:hidden">
            <BrandMark showName />
          </div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">{title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{subtitle}</p>
          <div className="mt-8">{children}</div>
          <div className="mt-7 text-sm text-muted-foreground">{footer}</div>
        </div>
      </div>
    </div>
  )
}
