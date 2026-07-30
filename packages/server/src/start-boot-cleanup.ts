import type { InstantiationService } from '@superliora/agent-core';

import type { TokenStore } from '#/services/auth/tokenStore';
import type { AcquireLockResult } from './lock';

export interface BootFailureCleanup {
  tokenStore: TokenStore;
  lockHandle: AcquireLockResult;
  ix?: InstantiationService;
}

/** Release lock and dispose token/container after a boot-time failure. */
export async function cleanupBootFailure(deps: BootFailureCleanup): Promise<void> {
  try {
    deps.ix?.dispose();
  } catch {
    // ignore
  }
  try {
    await deps.tokenStore.dispose();
  } catch {
    // best-effort cleanup of the token file on boot failure
  }
  deps.lockHandle.release();
}
