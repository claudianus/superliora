import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

import { rawTextPlugin } from '../../build/raw-text-plugin.mjs';

export default defineConfig({
  plugins: [rawTextPlugin()],
  resolve: {
    alias: [
      // Order matters — list MORE specific entries first so prefix matching
      // doesn't route them through the bare `@superliora/agent-core` alias
      // (which points at agent-core/src/index.ts, breaking subpath imports).
      {
        find: /^@superliora\/agent-core\/session\/store$/,
        replacement: fileURLToPath(
          new URL('../agent-core/src/session/store/index.ts', import.meta.url),
        ),
      },
      {
        find: /^@superliora\/agent-core\/base\/common\/event$/,
        replacement: fileURLToPath(
          new URL('../agent-core/src/base/common/event.ts', import.meta.url),
        ),
      },
      {
        find: '@superliora/sdk',
        replacement: fileURLToPath(
          new URL('../node-sdk/src/index.ts', import.meta.url),
        ),
      },
      {
        find: '@superliora/agent-core',
        replacement: fileURLToPath(
          new URL('../agent-core/src/index.ts', import.meta.url),
        ),
      },
      {
        find: '@superliora/protocol',
        replacement: fileURLToPath(
          new URL('../protocol/src/index.ts', import.meta.url),
        ),
      },
      {
        find: '@superliora/oauth',
        replacement: fileURLToPath(
          new URL('../oauth/src/index.ts', import.meta.url),
        ),
      },
    ],
  },
  test: {
    name: 'server',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ['test/**/*.{test,e2e}.ts'],
    // The server e2e tests pull in the full agent-core tree, which makes module
    // import very slow on Windows runners and destabilizes the test-windows job
    // (flaky timeouts and worker crashes). Skip them on Windows; they still run
    // on the Linux/macOS `test` job.
    exclude: process.platform === 'win32' ? ['test/**/*.e2e.test.ts'] : [],
  },
});
