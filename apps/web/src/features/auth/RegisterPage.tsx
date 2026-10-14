import { useState, type FormEvent, type ReactElement } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { registerSchema } from '@flowforge/shared'
import { ApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuthStore } from '@/stores/auth'
import { AuthLayout } from './AuthLayout'

export function RegisterPage(): ReactElement {
  const register = useAuthStore((state) => state.register)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next') ?? '/app'

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setError(null)

    const parsed = registerSchema.safeParse({ name, email, password })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check your details')
      return
    }

    setPending(true)
    try {
      await register(parsed.data.name, parsed.data.email, parsed.data.password)
      navigate(next, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to create your account')
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start collaborating in under a minute — no credit card required."
      footer={
        <>
          Already have an account?{' '}
          <Link className="font-medium text-primary hover:underline" to="/login">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" data-testid="register-form">
        <div className="space-y-1.5">
          <Label htmlFor="name">Full name</Label>
          <Input
            id="name"
            value={name}
            autoComplete="name"
            onChange={(event) => setName(event.target.value)}
            placeholder="Ada Lovelace"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Work email</Label>
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
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="At least 8 characters with a number"
          />
        </div>

        {error ? (
          <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthLayout>
  )
}
