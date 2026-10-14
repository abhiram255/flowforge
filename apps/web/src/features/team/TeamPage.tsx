import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Mail, Plus, Trash2, UserMinus } from 'lucide-react'
import { useState, type FormEvent, type ReactElement } from 'react'
import {
  ASSIGNABLE_ROLES,
  ROLE_LABELS,
  type InvitationDTO,
  type MemberDTO,
  type Role,
} from '@flowforge/shared'
import api, { ApiError } from '@/lib/api'
import { qk } from '@/lib/query'
import { formatDate } from '@/lib/utils'
import { toast } from 'sonner'
import { PageHeader } from '@/components/common/PageHeader'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { RoleBadge } from '@/components/common/badges'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState, LoadingScreen } from '@/components/ui/feedback'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { canManage, useWorkspace } from '@/hooks/useWorkspace'
import { useAuthStore } from '@/stores/auth'

function InviteDialog({ workspaceId }: { workspaceId: string }): ReactElement {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<(typeof ASSIGNABLE_ROLES)[number]>('member')
  const [created, setCreated] = useState<InvitationDTO | null>(null)
  const [error, setError] = useState<string | null>(null)

  const invite = useMutation({
    mutationFn: () =>
      api.post<{ invitation: InvitationDTO }>(`/workspaces/${workspaceId}/invitations`, {
        email,
        role,
      }),
    onSuccess: (payload) => {
      setCreated(payload.invitation)
      void queryClient.invalidateQueries({ queryKey: qk.invitations(workspaceId) })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not send the invitation'),
  })

  function onSubmit(event: FormEvent): void {
    event.preventDefault()
    setError(null)
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setError('Enter a valid email address')
      return
    }
    invite.mutate()
  }

  function reset(): void {
    setOpen(false)
    setCreated(null)
    setEmail('')
    setRole('member')
    setError(null)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : reset())}>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus /> Invite member
      </Button>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Invite a teammate</DialogTitle>
          <DialogDescription>
            They will get an email with a link to join this workspace in the role you choose.
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="space-y-3">
            <p className="text-sm">
              Invitation for <span className="font-medium">{created.email}</span> is ready.
            </p>
            {created.inviteUrl ? (
              <div className="space-y-1.5">
                <Label>Shareable link</Label>
                <div className="flex gap-2">
                  <Input readOnly value={created.inviteUrl} className="text-xs" />
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Copy invite link"
                    onClick={() => {
                      void navigator.clipboard.writeText(created.inviteUrl as string)
                      toast.success('Invite link copied')
                    }}
                  >
                    <Copy />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Shown here because no SMTP server is configured in development. Emails are sent
                  automatically when SMTP_URL is set.
                </p>
              </div>
            ) : null}
            <div className="flex justify-end">
              <Button onClick={reset}>Done</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                autoFocus
                onChange={(event) => setEmail(event.target.value)}
                placeholder="teammate@company.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={role} onValueChange={(value) => setRole(value as typeof role)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSIGNABLE_ROLES.map((entry) => (
                    <SelectItem key={entry} value={entry}>
                      {ROLE_LABELS[entry]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Viewers read only · Members create and edit work · Admins manage people and settings.
              </p>
            </div>

            {error ? (
              <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={reset}>
                Cancel
              </Button>
              <Button type="submit" disabled={invite.isPending}>
                {invite.isPending ? 'Inviting…' : 'Send invitation'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function TeamPage(): ReactElement {
  const workspace = useWorkspace()
  const queryClient = useQueryClient()
  const currentUser = useAuthStore((state) => state.user)
  const [pendingRemove, setPendingRemove] = useState<MemberDTO | null>(null)

  const membersQuery = useQuery({
    queryKey: qk.members(workspace.id),
    queryFn: () => api.get<{ data: MemberDTO[] }>(`/workspaces/${workspace.id}/members`),
  })
  const invitationsQuery = useQuery({
    queryKey: qk.invitations(workspace.id),
    queryFn: () => api.get<{ data: InvitationDTO[] }>(`/workspaces/${workspace.id}/invitations`),
    enabled: canManage(workspace.role),
  })

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: qk.members(workspace.id) })
    void queryClient.invalidateQueries({ queryKey: qk.invitations(workspace.id) })
    void queryClient.invalidateQueries({ queryKey: qk.workspaces })
  }

  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) =>
      api.patch(`/workspaces/${workspace.id}/members/${userId}`, { role }),
    onSuccess: () => {
      toast.success('Role updated')
      invalidate()
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not change the role'),
  })

  const removeMember = useMutation({
    mutationFn: (userId: string) => api.del(`/workspaces/${workspace.id}/members/${userId}`),
    onSuccess: () => {
      toast.success('Member removed')
      invalidate()
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not remove the member'),
  })

  const revokeInvitation = useMutation({
    mutationFn: (id: string) => api.del(`/workspaces/${workspace.id}/invitations/${id}`),
    onSuccess: () => {
      toast.success('Invitation revoked')
      invalidate()
    },
  })

  if (membersQuery.isLoading) return <LoadingScreen label="Loading members…" />

  const members = membersQuery.data?.data ?? []
  const invitations = invitationsQuery.data?.data ?? []
  const manageable = canManage(workspace.role)

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Team"
        description={`${members.length} member${members.length === 1 ? '' : 's'} in ${workspace.name}`}
        actions={manageable ? <InviteDialog workspaceId={workspace.id} /> : undefined}
      />

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {members.map((member) => {
              const isSelf = member.userId === currentUser?.id
              const canEditThis = manageable && !isSelf && member.role !== 'owner'
              return (
                <div key={member.userId} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <Avatar name={member.name} src={member.avatarUrl} seed={member.userId} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {member.name}
                      {isSelf ? <span className="ml-2 text-xs text-muted-foreground">(you)</span> : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                  </div>
                  <span className="hidden text-xs text-muted-foreground sm:block">
                    joined {formatDate(member.joinedAt)}
                  </span>

                  {canEditThis ? (
                    <Select
                      value={member.role}
                      onValueChange={(value) =>
                        changeRole.mutate({ userId: member.userId, role: value as Role })
                      }
                    >
                      <SelectTrigger className="h-8 w-32 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ASSIGNABLE_ROLES.map((entry) => (
                          <SelectItem key={entry} value={entry}>
                            {ROLE_LABELS[entry]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <RoleBadge role={member.role} />
                  )}

                  {canEditThis ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${member.name}`}
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setPendingRemove(member)}
                    >
                      <UserMinus />
                    </Button>
                  ) : null}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {manageable ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Pending invitations</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {invitations.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-muted-foreground">No pending invitations.</p>
            ) : (
              <div className="divide-y divide-border">
                {invitations.map((invitation) => (
                  <div key={invitation.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{invitation.email}</p>
                      <p className="text-xs text-muted-foreground">
                        expires {formatDate(invitation.expiresAt)}
                        {invitation.invitedBy ? ` · invited by ${invitation.invitedBy.name}` : ''}
                      </p>
                    </div>
                    <RoleBadge role={invitation.role} />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Revoke invitation for ${invitation.email}`}
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => revokeInvitation.mutate(invitation.id)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <EmptyState
          className="mt-6"
          title="Invitations are managed by admins"
          description="Ask a workspace admin to invite new teammates."
        />
      )}

      <ConfirmDialog
        open={Boolean(pendingRemove)}
        onOpenChange={(open) => !open && setPendingRemove(null)}
        title={`Remove ${pendingRemove?.name ?? 'member'}?`}
        description="They immediately lose access and are unassigned from all tasks."
        confirmLabel="Remove member"
        destructive
        onConfirm={() => {
          if (pendingRemove) removeMember.mutate(pendingRemove.userId)
        }}
      />
    </div>
  )
}
