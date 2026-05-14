import { defineConfig } from "vitest/config";

const isCI = !!process.env.CI;
const isWindows = process.platform === "win32";
const enableParallel = isCI && !isWindows;

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    environment: "node",
    fileParallelism: enableParallel,
    pool: "threads",
    poolOptions: { threads: { singleThread: !enableParallel } },
    testTimeout: 30000,
  },
});
