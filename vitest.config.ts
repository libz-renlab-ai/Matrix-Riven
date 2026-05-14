import { defineConfig } from "vitest/config";

// Windows + pnpm monorepo OOM workaround：本地单线程串行。
const isCI = !!process.env.CI;
const isWindows = process.platform === "win32";
const enableParallel = isCI && !isWindows;

export default defineConfig({
  test: {
    globals: false,
    include: ["packages/*/src/**/__tests__/**/*.test.ts"],
    environment: "node",
    fileParallelism: enableParallel,
    pool: "threads",
    poolOptions: { threads: { singleThread: !enableParallel } },
    testTimeout: 30000,
  },
});
