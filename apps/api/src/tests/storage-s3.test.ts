import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'

/**
 * S3 driver integration test. Runs only when an S3-compatible endpoint is
 * provided (`S3_TEST_ENDPOINT`) — locally and in CI against SeaweedFS
 * (`docker run chrislusf/seaweedfs server -s3 -s3.config=…`), which enforces
 * SigV4, so a passing run also proves the driver's request signing.
 */
const endpoint = process.env.S3_TEST_ENDPOINT
const accessKeyId = process.env.S3_TEST_ACCESS_KEY_ID ?? 'flowforge'
const secretAccessKey = process.env.S3_TEST_SECRET_ACCESS_KEY ?? 'flowforge-secret'
const bucket = process.env.S3_TEST_BUCKET ?? 'flowforge-test'

const collect = async (stream: NodeJS.ReadableStream): Promise<Buffer> => {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer))
  return Buffer.concat(chunks)
}

describe.skipIf(!endpoint)('S3 storage driver (SeaweedFS integration)', () => {
  it('round-trips a streamed upload, a read and a delete', async () => {
    process.env.STORAGE_DRIVER = 's3'
    process.env.S3_ENDPOINT = endpoint
    process.env.S3_BUCKET = bucket
    process.env.S3_ACCESS_KEY_ID = accessKeyId
    process.env.S3_SECRET_ACCESS_KEY = secretAccessKey
    process.env.S3_FORCE_PATH_STYLE = 'true'
    process.env.S3_REGION = 'us-east-1'

    // Dynamic imports so config/env sees the S3 configuration set above.
    const { S3Client, CreateBucketCommand } = await import('@aws-sdk/client-s3')
    const client = new S3Client({
      region: 'us-east-1',
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    })
    try {
      await client.send(new CreateBucketCommand({ Bucket: bucket }))
    } catch (error) {
      const name = (error as { name?: string }).name
      if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') throw error
    }

    const { getStorageDriver } = await import('../config/storage')
    const driver = getStorageDriver()
    expect(driver.kind).toBe('s3')

    const key = `test-storage/${Date.now()}-${Math.random().toString(36).slice(2)}.txt`
    const content = 'streamed to minio'
    await driver.putStream(key, Readable.from([content]), 'text/plain', Buffer.byteLength(content))
    expect((await collect(await driver.getStream(key))).toString()).toBe(content)

    await driver.delete(key)
    // getStream rejects directly for a missing key (unlike the local driver,
    // whose read stream errors on consumption).
    await expect(driver.getStream(key)).rejects.toThrow()
  })
})
