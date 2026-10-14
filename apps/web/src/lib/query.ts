import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

/** Central query key factory — keeps invalidation targets in one place. */
export const qk = {
  me: ['me'] as const,
  workspaces: ['workspaces'] as const,
  workspace: (ref: string | undefined) => ['workspace', ref] as const,
  dashboard: (workspaceId: string | undefined) => ['dashboard', workspaceId] as const,
  analytics: (workspaceId: string | undefined, range: number) => ['analytics', workspaceId, range] as const,
  projects: (workspaceId: string | undefined) => ['projects', workspaceId] as const,
  project: (projectId: string | undefined) => ['project', projectId] as const,
  tasks: (scope: Record<string, unknown>) => ['tasks', scope] as const,
  tasksRoot: ['tasks'] as const,
  task: (taskId: string | undefined) => ['task', taskId] as const,
  subtasks: (taskId: string | undefined) => ['subtasks', taskId] as const,
  comments: (taskId: string | undefined) => ['comments', taskId] as const,
  attachments: (taskId: string | undefined) => ['attachments', taskId] as const,
  members: (workspaceId: string | undefined) => ['members', workspaceId] as const,
  invitations: (workspaceId: string | undefined) => ['invitations', workspaceId] as const,
  activity: (scope: Record<string, unknown>) => ['activity', scope] as const,
  activityRoot: ['activity'] as const,
  notifications: ['notifications'] as const,
  notificationsUnread: ['notifications', 'unread'] as const,
  sessions: ['sessions'] as const,
}
