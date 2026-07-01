import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'kimi-core',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ['test/**/*.{test,e2e}.ts'],
  },
});
