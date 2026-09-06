import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'tui-renderer',
    include: ['test/**/*.test.ts'],
    // No vi.mock in this package — reuse the module graph across files.
    isolate: false,
  },
});
