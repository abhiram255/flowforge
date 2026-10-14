import { Types, type FilterQuery } from 'mongoose'
import type { ActivityDTO, Paginated } from '@flowforge/shared'
import type { WorkspaceContext } from '../../lib/context'
import { clampLimit, cursorFilter, finalizePage, parseCursor } from '../../lib/pagination'
import { toActivityDTO } from '../../lib/serialize'
import { uniq } from '../../lib/utils'
import { ActivityLog, type ActivityLogDoc } from '../../models/ActivityLog'
import { User } from '../../models/User'

export interface ActivityQuery {
  limit?: number
  cursor?: string
  projectId?: string
  taskId?: string
  actorId?: string
}

export async function listActivity(
  ctx: WorkspaceContext,
  query: ActivityQuery,
): Promise<Paginated<ActivityDTO>> {
  const limit = clampLimit(query.limit)
  const filter: FilterQuery<ActivityLogDoc> = {
    workspaceId: ctx.workspace._id,
    ...cursorFilter(parseCursor(query.cursor)),
  }
  if (query.projectId) filter.projectId = new Types.ObjectId(query.projectId)
  if (query.taskId) filter.taskId = new Types.ObjectId(query.taskId)
  if (query.actorId) filter.actorId = new Types.ObjectId(query.actorId)

  const docs = await ActivityLog.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean<ActivityLogDoc[]>()
  const page = finalizePage(docs, limit)

  const actorIds = uniq(page.data.map((doc) => String(doc.actorId)).filter((id) => id && id !== 'null'))
  const actors = await User.find({ _id: { $in: actorIds } })
    .select('name avatarUrl')
    .lean()
  const actorById = new Map(actors.map((actor) => [String(actor._id), actor]))

  return {
    data: page.data.map((doc) =>
      toActivityDTO(doc, doc.actorId ? actorById.get(String(doc.actorId)) ?? null : null),
    ),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  }
}
