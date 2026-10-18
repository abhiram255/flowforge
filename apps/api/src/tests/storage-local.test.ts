import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { getStorageDriver } from '../config/storage'

const collect = async (stream: NodeJS.ReadableStream): Promise<Buffer> => {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer))
  return Buffer.concat(chunks)
}

describe('local storage driver', () => {
  it('streams a file in, reads it back and deletes it', async () => {
    const driver = getStorageDriver()
    const key = `test-storage/${Date.now()}-${Math.random().toString(36).slice(2)}/file.txt`
    const content = 'streamed hello'
    await driver.putStream(key, Readable.from([content]), 'text/plain', Buffer.byteLength(content))
    expect((await collect(await driver.getStream(key))).toString()).toBe(content)
    await driver.delete(key)
    await expect(collect(await driver.getStream(key))).rejects.toThrow()
  })

  it('refuses unsafe storage keys', async () => {
    const driver = getStorageDriver()
    await expect(
      driver.putStream('../escape.txt', Readable.from(['x']), 'text/plain'),
    ).rejects.toThrow()
  })
})
