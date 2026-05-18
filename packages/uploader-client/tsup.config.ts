import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    outDir: 'dist',
    clean: false,
    splitting: false,
  },
  {
    entry: [
      'src/bin-uploader.ts',
      'src/bin-digital-twin-tap.ts',
      'src/bin-session-start.ts',
      'src/bin-user-prompt-submit.ts',
      'src/bin-digital-twin.ts',
      // Bucket 1/2 — new hooks for data collection breadth.
      'src/bin-pre-tool-use.ts',
      'src/bin-pre-compact.ts',
      'src/bin-session-end.ts',
    ],
    format: ['cjs'],
    target: 'node16',
    outDir: 'dist',
    clean: false,
    splitting: false,
    noExternal: ['ulid', '@matrix-riven/shared'],
  },
]);
