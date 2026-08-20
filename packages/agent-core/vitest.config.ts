import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'kimi-core',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    setupFiles: ['test/setup-windows-fs.ts'],
    include: ['test/**/*.{test,e2e}.ts'],
    // Keep current-time reminder token estimates stable across CI hosts.
    env: {
      TZ: 'UTC',
    },
  },
});
