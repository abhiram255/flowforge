import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, LogOut, ShieldCheck } from 'lucide-react'
import { useState, type FormEvent, type ReactElement, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { THEMES, type SessionDTO, type Theme, type UserDTO, type WorkspaceDTO } from '@flowforge/shared'
import api, { ApiError } from '@/lib/api'
import { qk } from '@/lib/query'
import { cn, formatRelative } from '@/lib/utils'
import { toast } from 'sonner'
import { PageHeader } from '@/components/common/PageHeader'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/feedback'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { canManage, useWorkspace } from '@/hooks/useWorkspace'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'

function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  description?: string
  disabled?: boolean
}): ReactElement {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-primary' : 'bg-muted',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-[18px]' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  )
}

function SettingRow({ children }: { children: ReactNode }): ReactElement {
  return <div className="space-y-4 py-1">{children}</div>
}

export function SettingsPage(): ReactElement {
  const workspace = useWorkspace()
  const user = useAuthStore((state) => state.user)
  const setUser = useAuthStore((state) => state.setUser)
  const logout = useAuthStore((state) => state.logout)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'workspace'

  const [workspaceName, setWorkspaceName] = useState(workspace.name)
  const [allowInvites, setAllowInvites] = useState(workspace.settings.allowMemberInvites)
  const [profileName, setProfileName] = useState(user?.name ?? '')
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? '')
  const { theme, setTheme } = useUiStore()
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const manageable = canManage(workspace.role)

  const sessionsQuery = useQuery({
    queryKey: qk.sessions,
    queryFn: () => api.get<{ data: SessionDTO[] }>('/auth/sessions'),
    enabled: tab === 'security',
  })

  const saveWorkspace = useMutation({
    mutationFn: () =>
      api.patch<{ workspace: WorkspaceDTO }>(`/workspaces/${workspace.id}`, {
        name: workspaceName,
        settings: { allowMemberInvites: allowInvites },
      }),
    onSuccess: () => {
      toast.success('Workspace updated')
      void queryClient.invalidateQueries({ queryKey: qk.workspaces })
      void queryClient.invalidateQueries({ queryKey: qk.workspace(workspace.slug) })
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not save'),
  })

  const saveProfile = useMutation({
    mutationFn: () =>
      api.patch<{ user: UserDTO }>('/users/me', {
        name: profileName,
        avatarUrl: avatarUrl.trim() ? avatarUrl.trim() : null,
      }),
    onSuccess: (payload) => {
      setUser(payload.user)
      toast.success('Profile updated')
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not save'),
  })

  const savePreference = useMutation({
    mutationFn: (patchBody: Record<string, boolean | Theme>) =>
      api.patch<{ user: UserDTO }>('/users/me/preferences', patchBody),
    onSuccess: (payload) => {
      setUser(payload.user)
    },
    onError: () => toast.error('Could not update preferences'),
  })

  const revokeSession = useMutation({
    mutationFn: (sessionId: string) => api.del(`/auth/sessions/${sessionId}`),
    onSuccess: () => {
      toast.success('Session revoked')
      void queryClient.invalidateQueries({ queryKey: qk.sessions })
    },
  })

  const revokeOthers = useMutation({
    mutationFn: () => api.del('/auth/sessions'),
    onSuccess: () => {
      toast.success('All other sessions signed out')
      void queryClient.invalidateQueries({ queryKey: qk.sessions })
    },
  })

  const leaveWorkspace = useMutation({
    mutationFn: () => api.post(`/workspaces/${workspace.id}/leave`),
    onSuccess: () => {
      toast.success(`You left ${workspace.name}`)
      void queryClient.invalidateQueries({ queryKey: qk.workspaces })
      navigate('/app')
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not leave'),
  })

  const deleteWorkspace = useMutation({
    mutationFn: () => api.del(`/workspaces/${workspace.id}`),
    onSuccess: () => {
      toast.success(`${workspace.name} deleted`)
      void queryClient.invalidateQueries({ queryKey: qk.workspaces })
      navigate('/app')
    },
    onError: (error) => toast.error(error instanceof ApiError ? error.message : 'Could not delete'),
  })

  function onWorkspaceSubmit(event: FormEvent): void {
    event.preventDefault()
    saveWorkspace.mutate()
  }

  function onProfileSubmit(event: FormEvent): void {
    event.preventDefault()
    saveProfile.mutate()
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Settings" description="Workspace configuration, your profile and security." />

      <Tabs value={tab} onValueChange={(value) => setParams({ tab: value })}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="workspace">Workspace</TabsTrigger>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="danger">Danger zone</TabsTrigger>
        </TabsList>

        {/* Workspace ------------------------------------------------------ */}
        <TabsContent value="workspace">
          <Card>
            <CardHeader>
              <CardTitle>Workspace</CardTitle>
              <CardDescription>
                {manageable
                  ? 'Only admins and the owner can change these settings.'
                  : 'Only workspace admins can change these settings.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={onWorkspaceSubmit}>
                <SettingRow>
                  <div className="space-y-1.5">
                    <Label htmlFor="ws-name">Name</Label>
                    <Input
                      id="ws-name"
                      value={workspaceName}
                      disabled={!manageable}
                      onChange={(event) => setWorkspaceName(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Workspace URL</Label>
                    <Input value={`/app/${workspace.slug}`} readOnly className="font-mono text-xs" />
                    <p className="text-xs text-muted-foreground">
                      Slugs are unique across FlowForge; contact support to change it.
                    </p>
                  </div>
                  <Toggle
                    label="Members can invite teammates"
                    description="When off, only admins and the owner can send invitations."
                    checked={allowInvites}
                    disabled={!manageable}
                    onChange={setAllowInvites}
                  />
                  {manageable ? (
                    <Button type="submit" disabled={saveWorkspace.isPending}>
                      {saveWorkspace.isPending ? 'Saving…' : 'Save workspace'}
                    </Button>
                  ) : null}
                </SettingRow>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Profile -------------------------------------------------------- */}
        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <CardTitle>Your profile</CardTitle>
              <CardDescription>How teammates see you across the workspace.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={onProfileSubmit}>
                <SettingRow>
                  <div className="space-y-1.5">
                    <Label htmlFor="profile-name">Full name</Label>
                    <Input
                      id="profile-name"
                      value={profileName}
                      onChange={(event) => setProfileName(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="profile-avatar">Avatar URL (optional)</Label>
                    <Input
                      id="profile-avatar"
                      value={avatarUrl}
                      onChange={(event) => setAvatarUrl(event.target.value)}
                      placeholder="https://…/avatar.png"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Theme</Label>
                    <Select
                      value={theme}
                      onValueChange={(value) => {
                        setTheme(value as Theme)
                        savePreference.mutate({ theme: value as Theme })
                      }}
                    >
                      <SelectTrigger className="w-48">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {THEMES.map((entry) => (
                          <SelectItem key={entry} value={entry}>
                            {entry[0]!.toUpperCase() + entry.slice(1)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button type="submit" disabled={saveProfile.isPending}>
                    {saveProfile.isPending ? 'Saving…' : 'Save profile'}
                  </Button>
                </SettingRow>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notifications -------------------------------------------------- */}
        <TabsContent value="notifications">
          <Card>
            <CardHeader>
              <CardTitle>Notification preferences</CardTitle>
              <CardDescription>Choose what FlowForge should tell you about.</CardDescription>
            </CardHeader>
            <CardContent>
              <SettingRow>
                <Toggle
                  label="In-app notifications"
                  description="Assignments, comments and status changes appear in the bell menu."
                  checked={user?.preferences.inAppNotifications ?? true}
                  onChange={(value) => savePreference.mutate({ inAppNotifications: value })}
                />
                <Toggle
                  label="Email notifications"
                  description="Used by invitation and digest emails when an SMTP server is configured."
                  checked={user?.preferences.emailNotifications ?? true}
                  onChange={(value) => savePreference.mutate({ emailNotifications: value })}
                />
              </SettingRow>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security ------------------------------------------------------- */}
        <TabsContent value="security">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" /> Active sessions
              </CardTitle>
              <CardDescription>
                Refresh tokens rotate on every use; reusing an old one revokes its whole family.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {sessionsQuery.isLoading ? <Spinner /> : null}
              {(sessionsQuery.data?.data ?? []).map((session) => (
                <div
                  key={session.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm">
                      {session.current ? 'This device' : session.userAgent ?? 'Unknown device'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {session.ip ?? 'unknown ip'} · started {formatRelative(session.createdAt)}
                    </p>
                  </div>
                  {!session.current ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => revokeSession.mutate(session.id)}
                    >
                      Revoke
                    </Button>
                  ) : (
                    <span className="text-xs text-emerald-500">Current</span>
                  )}
                </div>
              ))}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={revokeOthers.isPending}
                  onClick={() => revokeOthers.mutate()}
                >
                  Sign out other sessions
                </Button>
                <Button variant="outline" size="sm" onClick={() => void logout()}>
                  <LogOut /> Sign out everywhere
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Danger zone ---------------------------------------------------- */}
        <TabsContent value="danger">
          <Card className="border-destructive/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-4 w-4" /> Danger zone
              </CardTitle>
              <CardDescription>These actions cannot be undone.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {workspace.role === 'owner' ? (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Delete this workspace</p>
                    <p className="text-xs text-muted-foreground">
                      Removes all projects, tasks, comments, attachments and members.
                    </p>
                  </div>
                  <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
                    Delete workspace
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Leave this workspace</p>
                    <p className="text-xs text-muted-foreground">
                      You will lose access until you are invited again.
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setLeaveOpen(true)}>
                    Leave workspace
                  </Button>
                </div>
              )}
              {workspace.role === 'owner' ? (
                <p className="text-xs text-muted-foreground">
                  As the owner you cannot leave — transfer ownership to another member first.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        title={`Leave ${workspace.name}?`}
        description="You will be unassigned from all tasks in this workspace."
        confirmLabel="Leave workspace"
        destructive
        onConfirm={() => leaveWorkspace.mutate()}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${workspace.name}?`}
        description="Every project, task, comment and file in this workspace is permanently removed."
        confirmLabel="Delete forever"
        destructive
        onConfirm={() => deleteWorkspace.mutate()}
      />
    </div>
  )
}
