import { createReadStream } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Readable } from 'node:stream'
import { env } from './env'
import { logger } from './logger'
import { AppError } from '../lib/errors'

export interface StorageDriver {
  readonly kind: 'local' | 's3'
  put(key: string, data: Buffer, contentType: string): Promise<void>
  getStream(key: string): Promise<Readable>
  delete(key: string): Promise<void>
}

function assertSafeKey(key: string): void {
  if (key.includes('..') || key.startsWith('/') || key.startsWith('\\') || key.includes('\\')) {
    throw AppError.internal('Unsafe storage key')
  }
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

  async put(key: string, data: Buffer): Promise<void> {
    const target = this.resolve(key)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, data)
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

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    assertSafeKey(key)
    const { client, commands } = await this.getClient()
    await client.send(
      new commands.PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType }),
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
}

let driver: StorageDriver | null = null

export function getStorageDriver(): StorageDriver {
  if (!driver) {
    driver = env.STORAGE_DRIVER === 's3' ? new S3Driver() : new LocalDiskDriver(env.localStorageDirAbs)
    logger.info({ driver: driver.kind }, 'storage driver initialised')
  }
  return driver
}
