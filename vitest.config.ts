import { defineConfig } from 'vitest/config';

// Default pool is `forks`, maxWorkers = cpus-1. No project config (including
// apps/liora) overrides that. windows-latest is 4 vCPU / 16GB, so three
// isolated agent-core graphs OOM a fork; vitest then exits 1 with
// "Worker exited unexpectedly" and zero failed tests. Cap the pool on
// Windows only. Linux stays at the default.
const windowsMaxWorkers = process.platform === 'win32' ? 2 : undefined;

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/liora', 'apps/site', 'apps/vis/server', 'apps/vis/web'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    teardownTimeout: 15_000,
    ...(windowsMaxWorkers !== undefined ? { maxWorkers: windowsMaxWorkers } : {}),
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.spec.ts', '**/dist/**'],
      reporter: ['text', 'html'],
    },
  },
});
