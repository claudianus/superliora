import {
  ICoreProcessService,
  ITerminalService,
  SyncDescriptor,
  type InstantiationService,
  type ServiceCollection,
} from '@superliora/agent-core';
import type { AuthFailureLimiter } from '#/middleware/rateLimit';

import type { TokenStore } from '#/services/auth/tokenStore';
import type { AcquireLockResult } from '../lock';

export interface BootFailureCleanup {
  tokenStore: TokenStore;
  lockHandle: AcquireLockResult;
  ix?: InstantiationService;
  services?: ServiceCollection;
  app?: { close(): Promise<unknown> };
  authFailureLimiter?: AuthFailureLimiter | undefined;
}


export async function shutdownNativeServices(services: ServiceCollection): Promise<void> {
  const core = services.get(ICoreProcessService);
  const terminals = services.get(ITerminalService);
  const pending: Promise<void>[] = [];
  if (core !== undefined && !(core instanceof SyncDescriptor)) {
    pending.push(core.shutdown());
  }
  if (terminals !== undefined && !(terminals instanceof SyncDescriptor)) {
    pending.push(terminals.shutdown());
  }
  const results = await Promise.allSettled(pending);
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length > 0) {
    throw new AggregateError(failures.map((result) => result.reason), 'native server shutdown failed');
  }
}
/** Release lock and dispose token/container after a boot-time failure. */
export async function cleanupBootFailure(deps: BootFailureCleanup): Promise<void> {
  if (deps.services !== undefined) {
    await shutdownNativeServices(deps.services);
  }
  await deps.app?.close();
  deps.ix?.dispose();
  try {
    await deps.tokenStore.dispose();
  } catch {
    // best-effort cleanup of the token file on boot failure
  }
  deps.authFailureLimiter?.dispose();
  deps.lockHandle.release();
}
