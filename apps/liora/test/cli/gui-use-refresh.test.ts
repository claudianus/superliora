import { describe, expect, it, vi } from 'vitest';

vi.mock('#/cli/version', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#/cli/version')>();
  return {
    ...actual,
    tryGetHostPackageRoot: vi.fn(() => undefined),
    getHostPackageRoot: () => {
      throw new Error(
        'Could not locate package.json near C:\\Users\\Administrator\\AppData\\Local\\SuperLiora\\bin',
      );
    },
  };
});

import { refreshGuiUseAfterUpgrade } from '#/cli/update/gui-use-refresh';
import { getHostPackageRoot } from '#/cli/version';

describe('refreshGuiUseAfterUpgrade on a native host', () => {
  it('skips sidecar refresh instead of throwing when package.json is missing', async () => {
    expect(() => getHostPackageRoot()).toThrow(/Could not locate package.json/);

    await expect(refreshGuiUseAfterUpgrade()).resolves.toEqual({
      browserOk: false,
      computerOk: false,
      gitOk: true,
      warnings: [],
    });
  });
});
