import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      // More-specific subpaths first — bare `@superliora/agent-core` → index.ts
      // would otherwise swallow `@superliora/agent-core/mission` as index.ts/mission.
      {
        find: /^@superliora\/agent-core\/mission$/,
        replacement: fileURLToPath(
          new URL('../agent-core/src/mission/index.ts', import.meta.url),
        ),
      },
      {
        find: /^@superliora\/agent-core\/fleet$/,
        replacement: fileURLToPath(new URL('../agent-core/src/fleet/index.ts', import.meta.url)),
      },
      {
        find: /^@superliora\/agent-core\/ultrawork$/,
        replacement: fileURLToPath(
          new URL('../agent-core/src/mission/index.ts', import.meta.url),
        ),
      },
      {
        find: /^@superliora\/agent-core\/session\/store$/,
        replacement: fileURLToPath(
          new URL('../agent-core/src/session/store/index.ts', import.meta.url),
        ),
      },
      {
        find: /^@superliora\/agent-core\/(.+)$/,
        replacement: fileURLToPath(new URL('../agent-core/src/$1.ts', import.meta.url)),
      },
      {
        find: '@superliora/agent-core',
        replacement: fileURLToPath(new URL('../agent-core/src/index.ts', import.meta.url)),
      },
      {
        find: '@superliora/oauth',
        replacement: fileURLToPath(new URL('../oauth/src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    name: 'kimi-sdk',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      KIMI_LOG_LEVEL: 'off',
    },
    include: ['test/**/*.test.ts'],
  },
});
