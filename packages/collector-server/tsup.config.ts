import { defineConfig } from 'tsup';

// `tsconfig.build.json` excludes `**/__tests__/**` and `*.test.ts`. Without
// it, `dts: true` would walk into every test file and emit `.d.ts` / `.js`
// pairs for them under `dist/__tests__/`. `clean: true` on the first entry
// purges any stale test outputs from previous builds.
export default defineConfig([
  {
    entry: ['src/index.ts', 'src/mock-server.ts'],
    format: ['esm'],
    dts: true,
    outDir: 'dist',
    clean: true,
    splitting: false,
    tsconfig: './tsconfig.build.json',
  },
  {
    entry: ['src/bin-prod-server.ts'],
    format: ['cjs'],
    target: 'node16',
    outDir: 'dist',
    clean: false,
    splitting: false,
    noExternal: ['@matrix-riven/shared'],
    tsconfig: './tsconfig.build.json',
  },
]);
