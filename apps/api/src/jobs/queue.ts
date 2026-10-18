import { Worker } from 'bullmq'
import { Queue } from 'bullmq'
import client from 'prom-client'
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
let queueGauge: client.Gauge | null = null

export interface QueueCounts {
  waiting: number
  active: number
  delayed: number
  failed: number
  completed: number
}

/** BullMQ job counts, or null while the inline fallback is active (no Redis). */
export async function queueCounts(): Promise<QueueCounts | null> {
  if (!queue) return null
  try {
    const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed')
    return {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      delayed: counts.delayed ?? 0,
      failed: counts.failed ?? 0,
      completed: counts.completed ?? 0,
    }
  } catch {
    return null
  }
}

/** Queue depth as a Prometheus gauge — collected lazily on every scrape. */
function registerQueueGauge(): void {
  if (queueGauge) return
  queueGauge = new client.Gauge({
    name: 'flowforge_queue_jobs',
    help: 'Background jobs by state (BullMQ)',
    labelNames: ['state'],
    async collect() {
      const counts = await queueCounts()
      if (!counts) return
      for (const [state, value] of Object.entries(counts)) {
        queueGauge?.set({ state }, value)
      }
    },
  })
}

export function initQueues(): void {
  const connection = getRedisClient()
  if (!connection || queue) return
  queue = new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: JOB_DEFAULT_OPTIONS,
  })
  registerQueueGauge()
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
