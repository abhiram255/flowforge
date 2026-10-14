import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/tests/setup.ts'],
    // Integration tests share one MongoDB database and reset it per file.
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 60_000,
    reporters: ['default'],
  },
})
