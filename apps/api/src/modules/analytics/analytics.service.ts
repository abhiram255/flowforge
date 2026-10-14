import { Types } from 'mongoose'
import {
  TASK_STATUSES,
  type AnalyticsDTO,
  type CompletionPoint,
  type DashboardDTO,
  type StatusSlice,
  type TaskStatus,
  type WorkloadEntry,
} from '@flowforge/shared'
import { cache, cacheKeys } from '../../lib/cache'
import type { WorkspaceContext } from '../../lib/context'
import { toActivityDTO } from '../../lib/serialize'
import { ActivityLog, type ActivityLogDoc } from '../../models/ActivityLog'
import { Membership } from '../../models/Membership'
import { Project } from '../../models/Project'
import { Task, type TaskDoc } from '../../models/Task'
import { User } from '../../models/User'
import { decorateTasks } from '../tasks/tasks.service'

const DAY_MS = 86_400_000

const dayKey = (date: Date): string => date.toISOString().slice(0, 10)

async function workloadPipeline(workspaceId: Types.ObjectId, now: Date, limit: number) {
  const rows = await Task.aggregate<{ _id: Types.ObjectId; open: number; overdue: number }>([
    { $match: { workspaceId, status: { $ne: 'done' } } },
    { $unwind: '$assigneeIds' },
    {
      $group: {
        _id: '$assigneeIds',
        open: { $sum: 1 },
        overdue: {
          $sum: {
            $cond: [{ $and: [{ $ne: ['$dueDate', null] }, { $lt: ['$dueDate', now] }] }, 1, 0],
          },
        },
      },
    },
    { $sort: { open: -1 } },
    { $limit: limit },
  ])

  const users = await User.find({ _id: { $in: rows.map((row) => row._id) } })
    .select('name avatarUrl')
    .lean()
  const userById = new Map(users.map((user) => [String(user._id), user]))

  return rows.map<WorkloadEntry>((row) => {
    const user = userById.get(String(row._id))
    return {
      userId: String(row._id),
      name: user?.name ?? 'Unknown',
      avatarUrl: user?.avatarUrl ?? null,
      open: row.open,
      overdue: row.overdue,
    }
  })
}

export async function getAnalytics(ctx: WorkspaceContext, rangeDays = 30): Promise<AnalyticsDTO> {
  const workspaceId = ctx.workspace._id
  const key = cacheKeys.workspaceAnalytics(String(workspaceId), rangeDays)
  return cache.wrap(key, 60, () => computeAnalytics(workspaceId, rangeDays))
}

async function computeAnalytics(workspaceId: Types.ObjectId, rangeDays: number): Promise<AnalyticsDTO> {
  const now = new Date()
  const since = new Date(now.getTime() - rangeDays * DAY_MS)
  const prevSince = new Date(now.getTime() - rangeDays * 2 * DAY_MS)
  const sinceKey = dayKey(since)

  const [statusRows, trendFacet, overdueTasks, projectRows, cycleRows] = await Promise.all([
    Task.aggregate<{ _id: TaskStatus; count: number }>([
      { $match: { workspaceId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Task.aggregate<{
      completed: Array<{ _id: string; count: number }>
      created: Array<{ _id: string; count: number }>
    }>([
      {
        $match: {
          workspaceId,
          $or: [{ completedAt: { $gte: prevSince } }, { createdAt: { $gte: prevSince } }],
        },
      },
      {
        $facet: {
          completed: [
            { $match: { status: 'done', completedAt: { $gte: prevSince } } },
            {
              $group: {
                _id: { $dateToString: { format: '%Y-%m-%d', date: '$completedAt' } },
                count: { $sum: 1 },
              },
            },
          ],
          created: [
            { $match: { createdAt: { $gte: prevSince } } },
            {
              $group: {
                _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                count: { $sum: 1 },
              },
            },
          ],
        },
      },
    ]),
    Task.countDocuments({ workspaceId, status: { $ne: 'done' }, dueDate: { $ne: null, $lt: now } }),
    Project.aggregate<{ _id: Types.ObjectId; name: string; key: string; total: number; done: number }>([
      { $match: { workspaceId, status: 'active' } },
      {
        $lookup: {
          from: 'tasks',
          let: { projectId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$projectId', '$$projectId'] },
                    { $eq: ['$workspaceId', workspaceId] },
                  ],
                },
              },
            },
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                done: { $sum: { $cond: [{ $eq: ['$status', 'done'] }, 1, 0] } },
              },
            },
          ],
          as: 'stats',
        },
      },
      {
        $project: {
          name: 1,
          key: 1,
          total: { $ifNull: [{ $first: '$stats.total' }, 0] },
          done: { $ifNull: [{ $first: '$stats.done' }, 0] },
        },
      },
      { $sort: { name: 1 } },
    ]),
    Task.aggregate<{ _id: null; avgHours: number }>([
      { $match: { workspaceId, status: 'done', completedAt: { $ne: null } } },
      { $project: { hours: { $divide: [{ $subtract: ['$completedAt', '$createdAt'] }, 3_600_000] } } },
      { $group: { _id: null, avgHours: { $avg: '$hours' } } },
    ]),
  ])

  const statusCounts = Object.fromEntries(TASK_STATUSES.map((status) => [status, 0])) as Record<
    TaskStatus,
    number
  >
  for (const row of statusRows) statusCounts[row._id] = row.count
  const totalTasks = Object.values(statusCounts).reduce((sum, count) => sum + count, 0)

  const completedByDay = new Map((trendFacet[0]?.completed ?? []).map((row) => [row._id, row.count]))
  const createdByDay = new Map((trendFacet[0]?.created ?? []).map((row) => [row._id, row.count]))

  const completionTrend: CompletionPoint[] = []
  for (let offset = rangeDays - 1; offset >= 0; offset -= 1) {
    const key = dayKey(new Date(now.getTime() - offset * DAY_MS))
    completionTrend.push({
      date: key,
      completed: completedByDay.get(key) ?? 0,
      created: createdByDay.get(key) ?? 0,
    })
  }

  let completedLast30d = 0
  let completedPrev30d = 0
  for (const [key, count] of completedByDay) {
    if (key >= sinceKey) completedLast30d += count
    else completedPrev30d += count
  }

  const workload = await workloadPipeline(workspaceId, now, 10)

  const statusDistribution: StatusSlice[] = TASK_STATUSES.map((status) => ({
    status,
    count: statusCounts[status],
  }))

  return {
    overview: {
      totalTasks,
      openTasks: totalTasks - statusCounts.done,
      completedTasks: statusCounts.done,
      overdueTasks,
      completionRate: totalTasks > 0 ? Math.round((statusCounts.done / totalTasks) * 100) : 0,
      avgCycleTimeHours:
        cycleRows[0] !== undefined ? Math.round(cycleRows[0].avgHours * 10) / 10 : null,
      completedLast30d,
      completedPrev30d,
    },
    completionTrend,
    workload,
    statusDistribution,
    projects: projectRows.map((row) => ({
      id: String(row._id),
      name: row.name,
      key: row.key,
      total: row.total,
      done: row.done,
    })),
    generatedAt: now.toISOString(),
  }
}

export async function getDashboard(ctx: WorkspaceContext, userId: string): Promise<DashboardDTO> {
  const key = cacheKeys.workspaceDashboard(String(ctx.workspace._id), userId)
  return cache.wrap(key, 20, () => computeDashboard(ctx, userId))
}

async function computeDashboard(ctx: WorkspaceContext, userId: string): Promise<DashboardDTO> {
  const workspaceId = ctx.workspace._id
  const now = new Date()
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS)
  const nextWeek = new Date(now.getTime() + 7 * DAY_MS)

  const [assignedDocs, upcomingDocs, myOpenTasks, myOverdueTasks, myCompletedThisWeek, projectCount, memberCount, workload, activityDocs] =
    await Promise.all([
      Task.find({ workspaceId, assigneeIds: userId, status: { $ne: 'done' } })
        .sort({ updatedAt: -1 })
        .limit(8)
        .lean<TaskDoc[]>(),
      Task.find({
        workspaceId,
        assigneeIds: userId,
        status: { $ne: 'done' },
        dueDate: { $ne: null, $lte: nextWeek },
      })
        .sort({ dueDate: 1 })
        .limit(6)
        .lean<TaskDoc[]>(),
      Task.countDocuments({ workspaceId, assigneeIds: userId, status: { $ne: 'done' } }),
      Task.countDocuments({
        workspaceId,
        assigneeIds: userId,
        status: { $ne: 'done' },
        dueDate: { $ne: null, $lt: now },
      }),
      Task.countDocuments({
        workspaceId,
        assigneeIds: userId,
        status: 'done',
        completedAt: { $gte: weekAgo },
      }),
      Project.countDocuments({ workspaceId, status: 'active' }),
      Membership.countDocuments({ workspaceId }),
      workloadPipeline(workspaceId, now, 6),
      ActivityLog.find({ workspaceId })
        .sort({ createdAt: -1, _id: -1 })
        .limit(10)
        .lean<ActivityLogDoc[]>(),
    ])

  const [assignedTasks, upcomingDeadlines] = await Promise.all([
    decorateTasks(assignedDocs),
    decorateTasks(upcomingDocs),
  ])

  const actorIds = [...new Set(activityDocs.map((doc) => String(doc.actorId)).filter((id) => id && id !== 'null'))]
  const actors = await User.find({ _id: { $in: actorIds } })
    .select('name avatarUrl')
    .lean()
  const actorById = new Map(actors.map((actor) => [String(actor._id), actor]))

  return {
    myOpenTasks,
    myOverdueTasks,
    myCompletedThisWeek,
    projectCount,
    memberCount,
    assignedTasks,
    upcomingDeadlines,
    recentActivity: activityDocs.map((doc) =>
      toActivityDTO(doc, doc.actorId ? actorById.get(String(doc.actorId)) ?? null : null),
    ),
    workload,
  }
}
