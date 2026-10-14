import type { ReactElement, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Zap } from 'lucide-react'

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
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-10 lg:flex">
        <div
          className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-primary/25 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-24 -right-24 h-80 w-80 rounded-full bg-accent/40 blur-3xl"
          aria-hidden
        />

        <Link to="/" className="relative z-10 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            F
          </span>
          <span className="text-lg font-semibold tracking-tight">FlowForge</span>
        </Link>

        <div className="relative z-10 max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">
            Ship projects, not status updates.
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">
            FlowForge keeps your team aligned with live boards, task-level discussion and
            measurable delivery analytics.
          </p>
          <ul className="mt-6 space-y-3">
            {HIGHLIGHTS.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative z-10 flex items-center gap-2 text-xs text-muted-foreground">
          <Zap className="h-3.5 w-3.5" />
          Socket.IO realtime · MongoDB · Redis-ready
        </div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
              F
            </span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>
          <div className="mt-7">{children}</div>
          <div className="mt-6 text-sm text-muted-foreground">{footer}</div>
        </div>
      </div>
    </div>
  )
}
