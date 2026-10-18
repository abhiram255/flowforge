import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { INDEXED_MODELS, ensureIndexes } from '../scripts/ensure-indexes'
import { Task } from '../models/Task'
import { connectTestDatabase, disconnectTestDatabase } from './helpers'

describe('ensure-indexes script', () => {
  beforeAll(connectTestDatabase)
  afterAll(disconnectTestDatabase)

  it('builds indexes for every model (additive, never drops)', async () => {
    const results = await ensureIndexes()
    expect(results).toHaveLength(INDEXED_MODELS.length)

    // The compound board index the whole app relies on must exist after the run.
    const indexes = await Task.collection.indexes()
    const names = indexes.map((index) => index.name)
    expect(names).toContain('workspaceId_1_projectId_1_status_1_position_1')
    expect(names).toContain('workspaceId_1_title_text_description_text')
  })
})
