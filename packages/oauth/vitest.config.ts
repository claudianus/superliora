import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'kimi-oauth',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ['test/**/*.test.ts'],
  },
});
