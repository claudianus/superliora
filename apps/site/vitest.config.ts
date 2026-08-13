import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'site',
    environment: 'node',
    testTimeout: 30_000,
    include: ['test/**/*.test.ts'],
  },
});
