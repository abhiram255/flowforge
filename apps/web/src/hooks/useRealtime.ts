import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { NotificationDTO, Paginated, TaskDTO } from '@flowforge/shared'
import { toast } from 'sonner'
import { getAccessToken } from '../lib/api'
import { qk, queryClient as globalQueryClient } from '../lib/query'
import { connectSocket } from '../lib/socket'
import { useAuthStore } from '../stores/auth'
import { useRealtimeStore } from '../stores/realtime'

/**
 * One realtime subscription for the whole authenticated app:
 * - joins the active workspace room (membership verified server-side)
 * - patches caches in place for updates and invalidates for structural changes
 * - resynchronises everything on reconnect (missed events are refetched)
 */
export function useRealtime(workspaceId: string | undefined): void {
  const status = useAuthStore((state) => state.status)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (status !== 'authenticated') return
    const token = getAccessToken()
    if (!token) return

    const socket = connectSocket(token)
    const { setOnline, setProjectViewers, setLink } = useRealtimeStore.getState()

    const joinWorkspace = (): void => {
      if (workspaceId) socket.emit('workspace:join', { workspaceId }, () => undefined)
    }

    const handleConnect = (): void => {
      setLink('live')
      joinWorkspace()
      // Reconnect sync: anything missed while offline is refetched.
      void queryClient.invalidateQueries()
    }

    const handleDisconnect = (): void => setLink('offline')

    const invalidateAggregates = (): void => {
      void queryClient.invalidateQueries({ queryKey: qk.activityRoot })
      void queryClient.invalidateQueries({ queryKey: qk.dashboard(workspaceId) })
      void queryClient.invalidateQueries({ queryKey: ['analytics'] })
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
    }

    const upsertTaskInCaches = (task: TaskDTO): void => {
      queryClient.setQueriesData<Paginated<TaskDTO>>({ queryKey: qk.tasksRoot }, (old) =>
        old
          ? { ...old, data: old.data.map((entry) => (entry.id === task.id ? task : entry)) }
          : old,
      )
      queryClient.setQueryData<TaskDTO>(qk.task(task.id), (old) => (old ? task : old))
    }

    const removeTaskFromCaches = (taskId: string): void => {
      queryClient.setQueriesData<Paginated<TaskDTO>>({ queryKey: qk.tasksRoot }, (old) =>
        old ? { ...old, data: old.data.filter((entry) => entry.id !== taskId) } : old,
      )
      queryClient.removeQueries({ queryKey: qk.task(taskId) })
    }

    const onTaskCreated = (): void => {
      void queryClient.invalidateQueries({ queryKey: qk.tasksRoot })
      invalidateAggregates()
    }
    const onTaskUpdated = (payload: { task: TaskDTO }): void => {
      upsertTaskInCaches(payload.task)
      invalidateAggregates()
    }
    const onTaskDeleted = (payload: { taskId: string }): void => {
      removeTaskFromCaches(payload.taskId)
      invalidateAggregates()
    }
    const onCommentChanged = (payload: { taskId: string }): void => {
      void queryClient.invalidateQueries({ queryKey: qk.comments(payload.taskId) })
      void queryClient.invalidateQueries({ queryKey: qk.task(payload.taskId) })
    }
    const onAttachmentChanged = (payload: { taskId: string }): void => {
      void queryClient.invalidateQueries({ queryKey: qk.attachments(payload.taskId) })
      void queryClient.invalidateQueries({ queryKey: qk.task(payload.taskId) })
    }
    const onNotification = (payload: NotificationDTO): void => {
      void queryClient.invalidateQueries({ queryKey: qk.notifications })
      void queryClient.invalidateQueries({ queryKey: qk.notificationsUnread })
      toast(payload.title, { description: payload.body || undefined })
    }
    const onPresence = (payload: { online: number }): void => setOnline(payload.online)
    const onProjectPresence = (payload: { projectId: string; viewers: string[] }): void =>
      setProjectViewers(payload.projectId, payload.viewers)
    const onMemberChanged = (): void => {
      void queryClient.invalidateQueries({ queryKey: qk.workspaces })
      void queryClient.invalidateQueries({ queryKey: ['members'] })
      invalidateAggregates()
    }

    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('task:created', onTaskCreated)
    socket.on('task:updated', onTaskUpdated)
    socket.on('task:deleted', onTaskDeleted)
    socket.on('comment:created', onCommentChanged)
    socket.on('comment:updated', onCommentChanged)
    socket.on('comment:deleted', onCommentChanged)
    socket.on('attachment:created', onAttachmentChanged)
    socket.on('attachment:deleted', onAttachmentChanged)
    socket.on('notification:created', onNotification)
    socket.on('presence:update', onPresence)
    socket.on('presence:project', onProjectPresence)
    socket.on('member:changed', onMemberChanged)

    if (socket.connected) joinWorkspace()

    return () => {
      if (workspaceId) socket.emit('workspace:leave', { workspaceId })
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
      socket.off('task:created', onTaskCreated)
      socket.off('task:updated', onTaskUpdated)
      socket.off('task:deleted', onTaskDeleted)
      socket.off('comment:created', onCommentChanged)
      socket.off('comment:updated', onCommentChanged)
      socket.off('comment:deleted', onCommentChanged)
      socket.off('attachment:created', onAttachmentChanged)
      socket.off('attachment:deleted', onAttachmentChanged)
      socket.off('notification:created', onNotification)
      socket.off('presence:update', onPresence)
      socket.off('presence:project', onProjectPresence)
      socket.off('member:changed', onMemberChanged)
    }
  }, [status, workspaceId, queryClient])
}

/** Utility for tests and imperative cache patches outside React. */
export { globalQueryClient }
