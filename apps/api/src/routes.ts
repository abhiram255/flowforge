import { Router, type RequestHandler } from 'express'
import { checkRedisHealth, getCacheBackend } from './config/redis'
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

/** Liveness: the process is up; 503 only when the database connection is gone. */
export const healthHandler: RequestHandler = (_req, res) => {
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

/**
 * Readiness: what a load balancer should route on. The database must be
 * connected, and when REDIS_URL is configured (always in production) the
 * shared Redis connection must answer too — cache, queue and rate-limit state
 * are only correct across replicas with it.
 */
export const readinessHandler: RequestHandler = async (_req, res) => {
  const dbConnected = isDatabaseConnected()
  const redis = await checkRedisHealth()
  const ready = dbConnected && redis !== 'down'
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'degraded',
    checks: { db: dbConnected ? 'up' : 'down', redis },
    uptimeSeconds: Math.round(process.uptime()),
    version: APP_VERSION,
  })
}

export const v1Router = Router()

// /health and /health/ready live in app.ts, mounted ahead of the rate limiter —
// load-balancer probes must not consume the API budget.
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
