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
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Compass className="h-6 w-6" />
      </div>
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{message}</p>
      </div>
      <Button asChild variant="outline">
        <Link to="/app">Back to dashboard</Link>
      </Button>
    </div>
  )
}
