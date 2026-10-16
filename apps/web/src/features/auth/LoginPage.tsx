import { useState, type FormEvent, type ReactElement } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { loginSchema } from '@flowforge/shared'
import { ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuthStore } from '@/stores/auth'
import { AuthLayout } from './AuthLayout'

export function LoginPage(): ReactElement {
  const login = useAuthStore((state) => state.login)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next') ?? '/app'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setError(null)

    const parsed = loginSchema.safeParse({ email, password })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check your details')
      return
    }

    setPending(true)
    try {
      await login(parsed.data.email, parsed.data.password)
      navigate(next, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to sign in right now')
    } finally {
      setPending(false)
    }
  }

  function fillDemo(): void {
    setEmail('aarav.mehta@flowforge.dev')
    setPassword('Password123!')
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to continue to your workspaces."
      footer={
        <>
          New to FlowForge?{' '}
          <Link className="font-medium text-primary hover:underline" to="/register">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" data-testid="login-form">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@company.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
          />
        </div>

        {error ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm leading-relaxed text-destructive"
          >
            {error}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </Button>

        <button
          type="button"
          onClick={fillDemo}
          className="w-full py-1 text-center text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          Use demo credentials (seeded workspace)
        </button>
      </form>
    </AuthLayout>
  )
}
