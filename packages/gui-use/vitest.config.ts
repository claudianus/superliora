import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'gui-use',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ['test/**/*.test.ts'],
    // No vi.mock in this package — reuse the module graph across files.
    isolate: false,
  },
});
