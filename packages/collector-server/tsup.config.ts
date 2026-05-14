import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts', 'src/mock-server.ts'],
    format: ['esm'],
    dts: true,
    outDir: 'dist',
    clean: false,
    splitting: false,
  },
  {
    entry: ['src/bin-prod-server.ts'],
    format: ['cjs'],
    target: 'node16',
    outDir: 'dist',
    clean: false,
    splitting: false,
    noExternal: ['@matrix-riven/shared'],
  },
]);
