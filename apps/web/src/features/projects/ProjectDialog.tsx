import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent, type ReactElement, type ReactNode } from 'react'
import type { ProjectDTO } from '@flowforge/shared'
import api, { ApiError } from '@/lib/api'
import { qk } from '@/lib/query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export function ProjectDialog({
  workspaceId,
  project,
  trigger,
}: {
  workspaceId: string
  project?: ProjectDTO
  trigger: ReactNode
}): ReactElement {
  const isEdit = Boolean(project)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(project?.name ?? '')
  const [key, setKey] = useState(project?.key ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async () => {
      if (isEdit && project) {
        return api.patch<{ project: ProjectDTO }>(`/projects/${project.id}`, {
          name,
          description,
        })
      }
      return api.post<{ project: ProjectDTO }>(`/workspaces/${workspaceId}/projects`, {
        name,
        key: key.trim().toUpperCase(),
        description,
      })
    },
    onSuccess: (payload) => {
      toast.success(isEdit ? 'Project updated' : `Project ${payload.project.key} created`)
      void queryClient.invalidateQueries({ queryKey: qk.projects(workspaceId) })
      if (isEdit && project)
        void queryClient.invalidateQueries({ queryKey: qk.project(project.id) })
      setOpen(false)
      setError(null)
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Could not save the project'),
  })

  function onSubmit(event: FormEvent): void {
    event.preventDefault()
    if (name.trim().length < 2) {
      setError('Project name must be at least 2 characters')
      return
    }
    if (!isEdit && !/^[A-Za-z]{2,6}$/.test(key.trim())) {
      setError('Key must be 2–6 letters, for example WEB')
      return
    }
    mutation.mutate()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next && project) {
          setName(project.name)
          setDescription(project.description)
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Project settings' : 'New project'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Rename or re-describe this project.'
              : 'Projects group tasks into a Kanban board with a shared key.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="project-name">Name</Label>
            <Input
              id="project-name"
              value={name}
              autoFocus
              onChange={(event) => setName(event.target.value)}
              placeholder="Website Redesign"
            />
          </div>

          {!isEdit ? (
            <div className="space-y-1.5">
              <Label htmlFor="project-key">Key</Label>
              <Input
                id="project-key"
                value={key}
                maxLength={6}
                onChange={(event) => setKey(event.target.value.toUpperCase())}
                placeholder="WEB"
                className="font-mono uppercase"
              />
              <p className="text-xs text-muted-foreground">
                Task ids become {key || 'WEB'}-1, {key || 'WEB'}-2…
              </p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="project-description">Description</Label>
            <Textarea
              id="project-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What is this project about?"
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

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
