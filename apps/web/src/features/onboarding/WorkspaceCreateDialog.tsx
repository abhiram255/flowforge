import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent, type ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import type { WorkspaceDTO } from '@flowforge/shared'
import api, { ApiError } from '@/lib/api'
import { qk } from '@/lib/query'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'

/** Dialog with an optional trigger; works controlled and uncontrolled. */
export function WorkspaceCreateDialog({
  trigger,
  open: controlledOpen,
  onOpenChange,
  onCreated,
}: {
  trigger?: ReactElement
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onCreated?: (workspace: WorkspaceDTO) => void
}): ReactElement {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = onOpenChange ?? setUncontrolledOpen

  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const create = useMutation({
    mutationFn: () => api.post<{ workspace: WorkspaceDTO }>('/workspaces', { name }),
    onSuccess: (payload) => {
      toast.success(`Workspace "${payload.workspace.name}" created`)
      void queryClient.invalidateQueries({ queryKey: qk.workspaces })
      setOpen(false)
      setName('')
      if (onCreated) onCreated(payload.workspace)
      else navigate(`/app/${payload.workspace.slug}`)
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not create the workspace'),
  })

  function onSubmit(event: FormEvent): void {
    event.preventDefault()
    setError(null)
    if (name.trim().length < 2) {
      setError('Workspace name must be at least 2 characters')
      return
    }
    create.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create a workspace</DialogTitle>
          <DialogDescription>
            Workspaces hold projects, members and permissions. You will be the owner.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="workspace-name">Workspace name</Label>
            <Input
              id="workspace-name"
              value={name}
              autoFocus
              onChange={(event) => setName(event.target.value)}
              placeholder="Acme Corp"
            />
          </div>

          {error ? (
            <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create workspace'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
