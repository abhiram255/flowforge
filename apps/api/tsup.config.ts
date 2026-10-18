import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/scripts/seed.ts',
    'src/scripts/ensure-indexes.ts',
    'src/scripts/ensure-bucket.ts',
  ],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  sourcemap: true,
  clean: true,
  splitting: false,
  dts: false,
  // The workspace `@flowforge/shared` package ships TypeScript source, so it is
  // bundled into the output; everything else stays external (real dependencies).
  noExternal: ['@flowforge/shared'],
})
