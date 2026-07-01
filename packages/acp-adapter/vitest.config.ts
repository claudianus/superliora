import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'acp-adapter',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ['test/**/*.test.ts'],
  },
});
