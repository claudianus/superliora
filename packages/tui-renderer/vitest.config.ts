import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'tui-renderer',
    include: ['test/**/*.test.ts'],
  },
});
