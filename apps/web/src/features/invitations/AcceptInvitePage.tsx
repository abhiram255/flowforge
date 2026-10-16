import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, Loader2 } from 'lucide-react'
import type { ReactElement } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { Role, WorkspaceDTO } from '@flowforge/shared'
import api, { ApiError } from '@/lib/api'
import { qk } from '@/lib/query'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth'

interface InvitationPreview {
  workspaceName: string
  workspaceSlug: string
  email: string
  role: Role
  expiresAt: string
  invitedBy: string | null
}

export function AcceptInvitePage(): ReactElement {
  const { token } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const status = useAuthStore((state) => state.status)
  const user = useAuthStore((state) => state.user)

  const previewQuery = useQuery({
    queryKey: ['invitation', token],
    queryFn: () =>
      api.get<{ invitation: InvitationPreview }>(`/invitations/${token}`, { auth: false }),
    retry: false,
  })

  const accept = useMutation({
    mutationFn: () => api.post<{ workspace: WorkspaceDTO }>(`/invitations/${token}/accept`),
    onSuccess: (payload) => {
      toast.success(`Joined ${payload.workspace.name}`)
      void queryClient.invalidateQueries({ queryKey: qk.workspaces })
      navigate(`/app/${payload.workspace.slug}`, { replace: true })
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : 'Could not accept the invitation')
    },
  })

  const next = `/invite/${token}`

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <Card className="ff-brackets w-full max-w-md">
        <CardHeader>
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-md border border-primary/35 bg-primary-soft text-primary">
            <Building2 className="h-5 w-5" />
          </div>
          <CardTitle className="text-lg tracking-[-0.02em]">Workspace invitation</CardTitle>
          <CardDescription>
            {previewQuery.isLoading ? 'Checking your invitation…' : null}
            {previewQuery.isError ? 'This invitation is invalid, expired or already used.' : null}
            {previewQuery.data
              ? `${previewQuery.data.invitation.invitedBy ?? 'An admin'} invited you to join as ${previewQuery.data.invitation.role}.`
              : null}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {previewQuery.data ? (
            <div className="rounded-md border border-border bg-surface-2/40 p-4">
              <p className="text-sm font-semibold tracking-tight">
                {previewQuery.data.invitation.workspaceName}
              </p>
              <p className="ff-num mt-1 text-[10px] uppercase text-muted-foreground">
                For {previewQuery.data.invitation.email}
              </p>
            </div>
          ) : null}

          {status === 'loading' ? (
            <div className="flex justify-center py-2">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : status === 'anonymous' ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Sign in or create an account with the invited email address to accept.
              </p>
              <div className="flex gap-2">
                <Button asChild className="flex-1">
                  <Link to={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link>
                </Button>
                <Button asChild variant="outline" className="flex-1">
                  <Link to={`/register?next=${encodeURIComponent(next)}`}>Create account</Link>
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {user && previewQuery.data && user.email !== previewQuery.data.invitation.email ? (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm leading-relaxed text-destructive">
                  Signed in as {user.email} — this invitation was issued to{' '}
                  {previewQuery.data.invitation.email}.
                </p>
              ) : null}
              <Button
                className="w-full"
                disabled={accept.isPending || !previewQuery.data}
                onClick={() => accept.mutate()}
              >
                {accept.isPending ? 'Joining…' : 'Accept invitation'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
