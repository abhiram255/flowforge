/**
 * Non-destructive index build for deployments where MONGODB_AUTO_INDEX=false.
 *
 * Usage (in the API image):  node apps/api/dist/scripts/ensure-indexes.js
 * Runs as a one-shot compose service before the API replicas start, so a fresh
 * or large collection never triggers a surprise index build at boot.
 */
import mongoose from 'mongoose'
import { connectDatabase } from '../config/db'
import { logger } from '../config/logger'
import { ActivityLog } from '../models/ActivityLog'
import { Attachment } from '../models/Attachment'
import { Comment } from '../models/Comment'
import { Invitation } from '../models/Invitation'
import { Membership } from '../models/Membership'
import { Notification } from '../models/Notification'
import { Project } from '../models/Project'
import { Session } from '../models/Session'
import { Task } from '../models/Task'
import { User } from '../models/User'
import { Workspace } from '../models/Workspace'

export const INDEXED_MODELS = [
  ActivityLog,
  Attachment,
  Comment,
  Invitation,
  Membership,
  Notification,
  Project,
  Session,
  Task,
  User,
  Workspace,
] as const

export interface IndexBuildResult {
  collection: string
  ms: number
}

/** `createIndexes` is additive — unlike `syncIndexes`, it never drops indexes. */
export async function ensureIndexes(): Promise<IndexBuildResult[]> {
  const results: IndexBuildResult[] = []
  for (const model of INDEXED_MODELS) {
    const started = Date.now()
    await model.createIndexes()
    results.push({ collection: model.collection.collectionName, ms: Date.now() - started })
  }
  return results
}

const isDirectRun = process.argv[1]?.includes('ensure-indexes')
if (isDirectRun) {
  connectDatabase()
    .then(ensureIndexes)
    .then(async (results) => {
      const totalMs = results.reduce((sum, entry) => sum + entry.ms, 0)
      logger.info({ collections: results.length, totalMs, results }, 'ensure-indexes: done')
      await mongoose.disconnect()
      process.exit(0)
    })
    .catch((error) => {
      logger.error({ err: error }, 'ensure-indexes failed')
      process.exit(1)
    })
}
