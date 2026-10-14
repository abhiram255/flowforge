/**
 * Harness worker for Experiment 6.
 *
 * Uses the application's exact queue name, worker concurrency and Redis
 * connection settings (imported from src/jobs/queue.ts) but processes a
 * synthetic `experiment:sleep` job so that a worker can be killed mid-flight
 * and the recovery behaviour measured. This is a test double and is never
 * loaded by the application itself.
 *
 * Usage: tsx scripts/experiments/worker-harness.ts
 */
import { Worker } from 'bullmq'
import IORedis from 'ioredis'
import { QUEUE_NAME, WORKER_CONCURRENCY } from '../../src/jobs/queue'

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: null,
})

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    if (job.name !== 'experiment:sleep') return
    const ms = (job.data as { ms?: number }).ms ?? 2000
    const startedAt = Date.now()
    process.stdout.write(
      `${JSON.stringify({ event: 'start', jobId: job.id, attempt: job.attemptsMade + 1, at: startedAt })}\n`,
    )
    await new Promise((resolve) => setTimeout(resolve, ms))
    process.stdout.write(`${JSON.stringify({ event: 'done', jobId: job.id, at: Date.now() })}\n`)
  },
  { connection, concurrency: WORKER_CONCURRENCY },
)

worker.on('failed', (job, error) => {
  process.stdout.write(
    `${JSON.stringify({ event: 'failed', jobId: job?.id, err: error.message })}\n`,
  )
})

process.stdout.write(
  `${JSON.stringify({ event: 'worker-ready', pid: process.pid, concurrency: WORKER_CONCURRENCY })}\n`,
)
