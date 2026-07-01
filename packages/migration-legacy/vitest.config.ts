import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'migration-legacy',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ['test/**/*.test.ts'],
  },
});
