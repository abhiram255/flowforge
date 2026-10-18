import { describe, expect, it } from 'vitest'
import { cache } from '../lib/cache'

describe('cache.wrap', () => {
  it('serves repeated reads from the cache', async () => {
    let runs = 0
    const producer = async (): Promise<{ ok: true }> => {
      runs += 1
      return { ok: true }
    }
    expect(await cache.wrap('test:repeat', 30, producer)).toEqual({ ok: true })
    expect(await cache.wrap('test:repeat', 30, producer)).toEqual({ ok: true })
    expect(runs).toBe(1)
  })

  it('caches negative results instead of re-running the producer', async () => {
    let runs = 0
    const producer = async (): Promise<string | null> => {
      runs += 1
      return null
    }
    expect(await cache.wrap('test:negative', 30, producer)).toBeNull()
    expect(await cache.wrap('test:negative', 30, producer)).toBeNull()
    expect(runs).toBe(1)
  })

  it('preserves falsy values (0, false, empty string)', async () => {
    await cache.wrap('test:zero', 30, async () => 0)
    await cache.wrap('test:false', 30, async () => false)
    await cache.wrap('test:empty', 30, async () => '')
    const boom = async (): Promise<never> => {
      throw new Error('producer must not run — the cached value counts as a hit')
    }
    expect(await cache.wrap('test:zero', 30, boom)).toBe(0)
    expect(await cache.wrap('test:false', 30, boom)).toBe(false)
    expect(await cache.wrap('test:empty', 30, boom)).toBe('')
  })

  it('coalesces concurrent cold reads onto a single producer', async () => {
    let runs = 0
    const producer = async (): Promise<string> => {
      runs += 1
      await new Promise((resolve) => setTimeout(resolve, 25))
      return 'shared'
    }
    const results = await Promise.all([
      cache.wrap('test:coalesce', 30, producer),
      cache.wrap('test:coalesce', 30, producer),
      cache.wrap('test:coalesce', 30, producer),
    ])
    expect(runs).toBe(1)
    expect(results).toEqual(['shared', 'shared', 'shared'])
  })

  it('bounds the in-process store and evicts oldest entries', async () => {
    const cap = 5000 // CACHE_MEMORY_MAX_ENTRIES default; sweeps run every 100 writes
    for (let index = 0; index < cap + 100; index += 1) {
      await cache.wrap(`test:cap:${index}`, 60, async () => `v:${index}`)
    }
    const regenerate = async (): Promise<string> => 'regenerated'
    expect(await cache.wrap('test:cap:0', 60, regenerate)).toBe('regenerated')
    expect(await cache.wrap(`test:cap:${cap + 99}`, 60, regenerate)).toBe(`v:${cap + 99}`)
  })
})
