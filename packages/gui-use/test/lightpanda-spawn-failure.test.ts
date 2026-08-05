import { describe, expect, it } from 'vitest';

import { LightpandaBrowserRuntime } from '../src/browser/lightpanda-browser';

describe('LightpandaBrowserRuntime spawn failures', () => {
  it('rejects instead of crashing the host when the binary is missing', async () => {
    const uncaught: unknown[] = [];
    const onUncaught = (error: unknown) => uncaught.push(error);
    process.on('uncaughtException', onUncaught);

    const runtime = new LightpandaBrowserRuntime({
      binaryPath: '/nonexistent/superliora-lightpanda-spawn-test',
      autoInstall: false,
    });

    try {
      await expect(runtime.observe({ url: 'https://example.com' })).rejects.toThrow();
      // The ENOENT arrives on the next tick; without an `error` listener Node
      // escalates it to an uncaughtException after the await already resolved.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(uncaught).toEqual([]);
    } finally {
      process.off('uncaughtException', onUncaught);
      await runtime.close().catch(() => undefined);
    }
  }, 30_000);
});
