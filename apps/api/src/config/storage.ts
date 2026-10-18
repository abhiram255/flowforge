import { createReadStream, createWriteStream, mkdirSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { Readable } from 'node:stream'
import { env } from './env'
import { logger } from './logger'
import { AppError } from '../lib/errors'

export interface StorageDriver {
  readonly kind: 'local' | 's3'
  /**
   * Store a stream (uploads arrive as temp files on disk — never as heap
   * buffers). `contentLength` lets the S3 driver stream a single PUT instead
   * of buffering to discover the size.
   */
  putStream(key: string, stream: Readable, contentType: string, contentLength?: number): Promise<void>
  getStream(key: string): Promise<Readable>
  delete(key: string): Promise<void>
}

function assertSafeKey(key: string): void {
  if (key.includes('..') || key.startsWith('/') || key.startsWith('\\') || key.includes('\\')) {
    throw AppError.internal('Unsafe storage key')
  }
}

/** Multer does not create its destination directory; do it before first use. */
export function ensureUploadTmpDir(): void {
  mkdirSync(env.uploadTmpDirAbs, { recursive: true })
}

class LocalDiskDriver implements StorageDriver {
  readonly kind = 'local' as const
  private readonly baseDir: string

  constructor(baseDir: string) {
    this.baseDir = baseDir
  }

  private resolve(key: string): string {
    assertSafeKey(key)
    return path.join(this.baseDir, key)
  }

  async putStream(key: string, stream: Readable): Promise<void> {
    const target = this.resolve(key)
    await mkdir(path.dirname(target), { recursive: true })
    try {
      await pipeline(stream, createWriteStream(target))
    } catch (error) {
      await rm(target, { force: true }).catch(() => undefined)
      throw error
    }
  }

  async getStream(key: string): Promise<Readable> {
    const target = this.resolve(key)
    return createReadStream(target)
  }

  async delete(key: string): Promise<void> {
    const target = this.resolve(key)
    await rm(target, { force: true })
  }
}

class S3Driver implements StorageDriver {
  readonly kind = 's3' as const
  private clientPromise: Promise<{
    client: import('@aws-sdk/client-s3').S3Client
    commands: typeof import('@aws-sdk/client-s3')
  }> | null = null

  private getClient(): Promise<{
    client: import('@aws-sdk/client-s3').S3Client
    commands: typeof import('@aws-sdk/client-s3')
  }> {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const commands = await import('@aws-sdk/client-s3')
        const client = new commands.S3Client({
          region: env.S3_REGION,
          endpoint: env.S3_ENDPOINT || undefined,
          forcePathStyle: env.S3_FORCE_PATH_STYLE,
          credentials: {
            accessKeyId: env.S3_ACCESS_KEY_ID as string,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY as string,
          },
        })
        return { client, commands }
      })()
    }
    return this.clientPromise
  }

  private get bucket(): string {
    if (!env.S3_BUCKET) throw AppError.internal('S3 bucket is not configured')
    return env.S3_BUCKET
  }

  async putStream(
    key: string,
    stream: Readable,
    contentType: string,
    contentLength?: number,
  ): Promise<void> {
    assertSafeKey(key)
    const { client, commands } = await this.getClient()
    // With ContentLength set, the SDK streams the body straight to the socket;
    // multipart (lib-storage) is unnecessary below the 10 MB upload cap.
    await client.send(
      new commands.PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: stream,
        ContentType: contentType,
        ...(contentLength === undefined ? {} : { ContentLength: contentLength }),
      }),
    )
  }

  async getStream(key: string): Promise<Readable> {
    assertSafeKey(key)
    const { client, commands } = await this.getClient()
    const result = await client.send(new commands.GetObjectCommand({ Bucket: this.bucket, Key: key }))
    return result.Body as Readable
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key)
    const { client, commands } = await this.getClient()
    await client.send(new commands.DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }

  /** Idempotent: creates the configured bucket when it does not exist yet. */
  async ensureBucket(): Promise<void> {
    const { client, commands } = await this.getClient()
    try {
      await client.send(new commands.HeadBucketCommand({ Bucket: this.bucket }))
      return
    } catch (error) {
      const name = (error as { name?: string }).name
      if (name !== 'NotFound' && name !== 'NoSuchBucket') throw error
    }
    try {
      await client.send(new commands.CreateBucketCommand({ Bucket: this.bucket }))
    } catch (error) {
      const name = (error as { name?: string }).name
      if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') throw error
    }
  }
}

let driver: StorageDriver | null = null

export function getStorageDriver(): StorageDriver {
  if (!driver) {
    driver = env.STORAGE_DRIVER === 's3' ? new S3Driver() : new LocalDiskDriver(env.localStorageDirAbs)
    logger.info({ driver: driver.kind }, 'storage driver initialised')
  }
  return driver
}

/** S3-only: ensure the configured bucket exists (used by the compose init step). */
export async function ensureBucket(): Promise<void> {
  const current = getStorageDriver()
  if (current.kind !== 's3') return
  await (current as S3Driver).ensureBucket()
}
