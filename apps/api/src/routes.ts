import { Router, type RequestHandler } from 'express'
import { getCacheBackend } from './config/redis'
import { isDatabaseConnected } from './config/db'
import { APP_VERSION } from './config/env'
import { queueBackend } from './jobs/queue'
import { activityRoutes } from './modules/activity/activity.routes'
import { analyticsRoutes } from './modules/analytics/analytics.routes'
import { authRoutes } from './modules/auth/auth.routes'
import { attachmentsRoutes, taskAttachmentsRoutes } from './modules/attachments/attachments.routes'
import { commentsRoutes, taskCommentsRoutes } from './modules/comments/comments.routes'
import { notificationsRoutes } from './modules/notifications/notifications.routes'
import { projectsRoutes, workspacesProjectsRoutes } from './modules/projects/projects.routes'
import { projectTasksRoutes, tasksRoutes } from './modules/tasks/tasks.routes'
import { usersRoutes } from './modules/users/users.routes'
import { invitationsRoutes, workspacesRoutes } from './modules/workspaces/workspaces.routes'

const healthHandler: RequestHandler = (_req, res) => {
  const dbConnected = isDatabaseConnected()
  res.status(dbConnected ? 200 : 503).json({
    status: dbConnected ? 'ok' : 'degraded',
    uptimeSeconds: Math.round(process.uptime()),
    db: dbConnected ? 'connected' : 'disconnected',
    cache: getCacheBackend(),
    queues: queueBackend(),
    version: APP_VERSION,
  })
}

export const v1Router = Router()

v1Router.get('/health', healthHandler)
v1Router.use('/auth', authRoutes)
v1Router.use('/users', usersRoutes)
v1Router.use('/invitations', invitationsRoutes)
v1Router.use('/workspaces/:workspaceId/projects', workspacesProjectsRoutes)
v1Router.use('/workspaces/:workspaceId/analytics', analyticsRoutes)
v1Router.use('/workspaces/:workspaceId/activity', activityRoutes)
v1Router.use('/workspaces', workspacesRoutes)
v1Router.use('/projects/:projectId/tasks', projectTasksRoutes)
v1Router.use('/projects', projectsRoutes)
v1Router.use('/tasks/:taskId/comments', taskCommentsRoutes)
v1Router.use('/tasks/:taskId/attachments', taskAttachmentsRoutes)
v1Router.use('/tasks', tasksRoutes)
v1Router.use('/comments', commentsRoutes)
v1Router.use('/attachments', attachmentsRoutes)
v1Router.use('/notifications', notificationsRoutes)
