import { describe, expect, it, vi } from 'vitest';

import { LioraHarness } from '#/harness/liora-harness';
import type { SDKRpcClientBase } from '#/rpc/rpc';
import type { LioraAuthFacade } from '#/auth';

describe('LioraHarness.close', () => {
  it('still shuts down the RPC when the beforeClose hook fails, then rethrows the hook failure', async () => {
    const onClose = vi.fn();
    const harness = new LioraHarness({} as SDKRpcClientBase, {
      homeDir: '/home', configPath: '/home/config.toml', auth: {} as LioraAuthFacade,
      telemetry: { track: () => {} }, ensureConfigFile: async () => {}, onClose,
      beforeClose: async () => { throw new Error('Coordinator close failed'); },
    });
    await expect(harness.close()).rejects.toThrow('Coordinator close failed');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
