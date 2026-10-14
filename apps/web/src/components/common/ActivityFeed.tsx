import type { ReactElement } from 'react'
import type { ActivityDTO } from '@flowforge/shared'
import { Avatar } from '../ui/avatar'
import { formatRelative } from '@/lib/utils'

const ACTION_COPY: Record<string, string> = {
  'workspace.created': 'created the workspace',
  'workspace.updated': 'updated workspace settings',
  'member.joined': 'joined the workspace',
  'member.left': 'left the workspace',
  'member.role_changed': 'changed a member role',
  'member.removed': 'removed a member',
  'invitation.created': 'invited a teammate',
  'invitation.revoked': 'revoked an invitation',
  'project.created': 'created a project',
  'project.updated': 'updated a project',
  'project.archived': 'archived a project',
  'project.deleted': 'deleted a project',
  'task.created': 'created a task',
  'task.updated': 'updated a task',
  'task.completed': 'completed a task',
  'task.deleted': 'deleted a task',
  'comment.created': 'commented on a task',
  'comment.deleted': 'deleted a comment',
  'attachment.uploaded': 'uploaded a file',
  'attachment.deleted': 'removed a file',
}

function describe(entry: ActivityDTO): string {
  const verb = ACTION_COPY[entry.action] ?? entry.action
  const detail =
    (entry.metadata.key as string | undefined) ??
    (entry.metadata.name as string | undefined) ??
    (entry.metadata.filename as string | undefined) ??
    (entry.metadata.email as string | undefined)
  return detail ? `${verb} · ${detail}` : verb
}

export function ActivityFeed({
  entries,
  emptyLabel = 'No activity yet',
}: {
  entries: ActivityDTO[]
  emptyLabel?: string
}): ReactElement {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>
  }

  return (
    <ol className="space-y-3">
      {entries.map((entry) => (
        <li key={entry.id} className="flex items-start gap-3">
          <Avatar
            name={entry.actor?.name ?? 'System'}
            src={entry.actor?.avatarUrl ?? null}
            seed={entry.actor?.id ?? 'system'}
            className="h-6 w-6"
          />
          <div className="min-w-0 text-sm">
            <p className="truncate">
              <span className="font-medium">{entry.actor?.name ?? 'System'}</span>{' '}
              <span className="text-muted-foreground">{describe(entry)}</span>
            </p>
            <p className="text-xs text-muted-foreground">{formatRelative(entry.createdAt)}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}
