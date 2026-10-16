import { Compass } from 'lucide-react'
import type { ReactElement } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'

export function NotFoundPage({
  title = 'Page not found',
  message = 'The page you are looking for does not exist or has moved.',
}: {
  title?: string
  message?: string
}): ReactElement {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="ff-panel ff-brackets flex h-14 w-14 items-center justify-center rounded-lg text-muted-foreground">
        <Compass className="h-6 w-6" />
      </div>
      <div>
        <p className="ff-label text-muted-foreground">Error 404</p>
        <h1 className="mt-2.5 text-xl font-semibold tracking-[-0.02em]">{title}</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
          {message}
        </p>
      </div>
      <Button asChild variant="outline">
        <Link to="/app">Back to dashboard</Link>
      </Button>
    </div>
  )
}
