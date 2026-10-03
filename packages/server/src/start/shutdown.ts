import type { InstantiationService, ServiceCollection } from '@superliora/agent-core';

import type { AuthFailureLimiter } from '#/middleware/rateLimit';
import type { TokenStore } from '#/services/auth/tokenStore';
import {
  IConnectionRegistry,
  IServerShutdownService,
  IWSBroadcastService,
  IWSGateway,
} from '#/services/gateway';
import type { AcquireLockResult } from '../lock';
import type { ServerLogger } from '../services/pinoLoggerService';
import type { ServerStartOptions } from './types';
import { shutdownNativeServices } from './boot-cleanup';

interface ShutdownHost {
  close(): Promise<unknown>;
}

export interface CreateServerCloserOptions {
  ix: InstantiationService;
  app: ShutdownHost;
  tokenStore: TokenStore;
  lockHandle: AcquireLockResult;
  authFailureLimiter: AuthFailureLimiter | undefined;
  logger: ServerLogger;
  serviceOverrides: ServerStartOptions['serviceOverrides'];
  services: ServiceCollection;
}

export function createServerCloser(opts: CreateServerCloserOptions): () => Promise<void> {
  let closing: Promise<void> | undefined;
  return (): Promise<void> => {
    if (closing !== undefined) return closing;
    const completion = Promise.withResolvers<void>();
    closing = completion.promise;
    void close().then(completion.resolve, completion.reject);
    return closing;
  };

  async function close(): Promise<void> {
    await shutdownNativeServices(opts.services);

    opts.ix.invokeFunction((a) => a.get(IWSGateway));
    opts.ix.invokeFunction((a) => {
      a.get(IConnectionRegistry).closeAll('server shutting down');
    });

    await opts.app.close();

    await opts.ix.invokeFunction((a) => a.get(IWSBroadcastService).flushAndClose());

    opts.ix.dispose();

    // The persistent token is intentionally left on disk so it survives the
    // next start (ROADMAP M5.1). dispose() is a no-op for the persistent store;
    // the call is kept so the interface is honored uniformly and a test
    // override can still observe shutdown.
    await opts.tokenStore.dispose();

    // Stop the auth-failure limiter's cleanup timer (ROADMAP M6.4). Only set
    // on non-loopback binds; the `?.` is a no-op on loopback.
    opts.authFailureLimiter?.dispose();

    opts.lockHandle.release();
  }
}

export function registerDefaultShutdownService(
  opts: CreateServerCloserOptions,
  doClose: () => Promise<void>,
): void {
  const hasShutdownOverride = opts.serviceOverrides?.some(
    ([id]) => id === IServerShutdownService,
  );
  if (!hasShutdownOverride) {
    opts.services.set(IServerShutdownService, {
      _serviceBrand: undefined,
      requestShutdown: async (reason: string) => {
        opts.logger.info({ reason }, 'server shutdown requested');
        await doClose();
        process.exit(0);
      },
    });
  }
}
