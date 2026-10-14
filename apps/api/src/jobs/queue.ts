import { Worker } from 'bullmq'
import { Queue } from 'bullmq'
import { logger } from '../config/logger'
import { getRedisClient } from '../config/redis'
import type { MailMessage } from '../lib/mailer'
import {
  processDeliverNotifications,
  processSendEmail,
  type NotificationDeliveryItem,
} from './processors'

export interface JobPayloads {
  'send-email': MailMessage
  'deliver-notifications': { items: NotificationDeliveryItem[] }
}

export type JobName = keyof JobPayloads

export const QUEUE_NAME = 'flowforge-jobs'

/** Retry/backoff policy shared by the application queue and the experiment harness. */
export const JOB_DEFAULT_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 1000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
}

/** How many jobs one worker processes in parallel. */
export const WORKER_CONCURRENCY = 5

let queue: Queue | null = null
let worker: Worker | null = null

export function initQueues(): void {
  const connection = getRedisClient()
  if (!connection || queue) return
  queue = new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: JOB_DEFAULT_OPTIONS,
  })
  logger.info('BullMQ job queue initialised')
}

export function startWorkers(): void {
  const connection = getRedisClient()
  if (!connection || worker) return
  worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      if (job.name === 'send-email') {
        await processSendEmail(job.data as MailMessage)
      } else if (job.name === 'deliver-notifications') {
        await processDeliverNotifications(job.data as { items: NotificationDeliveryItem[] })
      }
    },
    { connection, concurrency: WORKER_CONCURRENCY },
  )
  worker.on('failed', (job, err) => logger.warn({ job: job?.name, err: err.message }, 'job failed'))
  logger.info('BullMQ workers started')
}

/**
 * Enqueue a background job. Without Redis (local development, tests) the job
 * runs inline so behaviour stays correct — only latency characteristics change.
 */
export async function enqueue<K extends JobName>(name: K, payload: JobPayloads[K]): Promise<void> {
  if (queue) {
    try {
      await queue.add(name, payload)
      return
    } catch (error) {
      logger.warn(
        { err: (error as Error).message, job: name },
        'queue unavailable — processing inline',
      )
    }
  }
  if (name === 'send-email') await processSendEmail(payload as MailMessage)
  else await processDeliverNotifications(payload as { items: NotificationDeliveryItem[] })
}

export async function closeQueues(): Promise<void> {
  await worker?.close().catch(() => undefined)
  await queue?.close().catch(() => undefined)
  worker = null
  queue = null
}

export function queueBackend(): 'redis' | 'inline' {
  return queue ? 'redis' : 'inline'
}
