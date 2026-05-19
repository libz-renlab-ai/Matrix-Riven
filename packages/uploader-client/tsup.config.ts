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
      'src/bin-auto-updater.ts',
    ],
    format: ['cjs'],
    target: 'node16',
    outDir: 'dist',
    clean: false,
    splitting: false,
    noExternal: ['ulid', '@matrix-riven/shared'],
  },
]);
