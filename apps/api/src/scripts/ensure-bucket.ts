/**
 * Creates the configured S3 bucket when it is missing (idempotent).
 *
 * Usage (in the API image):  node apps/api/dist/scripts/ensure-bucket.js
 * Runs as a one-shot compose service before the API replicas start, so the
 * shared attachment store is ready without bucket creation at request time.
 */
import { env } from '../config/env'
import { logger } from '../config/logger'
import { ensureBucket } from '../config/storage'

const isDirectRun = process.argv[1]?.includes('ensure-bucket')
if (isDirectRun) {
  (async () => {
    if (env.STORAGE_DRIVER !== 's3') {
      logger.info('storage driver is local — no bucket to ensure')
      return
    }
    await ensureBucket()
    logger.info({ bucket: env.S3_BUCKET }, 'ensure-bucket: done')
  })()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      logger.error({ err: error }, 'ensure-bucket failed')
      process.exit(1)
    })
}
