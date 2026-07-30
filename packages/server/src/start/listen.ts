import type { IRestGateway } from '#/services/gateway';
import type { ServerLogger } from '../services/pinoLoggerService';

/**
 * Maximum consecutive `EADDRINUSE` retries when the requested port is busy.
 * Caps the `port + 1` walk so a permanently-saturated range cannot loop
 * forever; 100 matches the daemon spawner's own scan window in `resolveDaemonPort`.
 */
export const PORT_RETRY_LIMIT = 100;

export interface ListenWithPortRetryOptions {
  gateway: IRestGateway;
  host: string;
  port: number;
  logger: ServerLogger;
  /** Override the retry cap — used by tests to keep the walk short. */
  maxRetries?: number;
}

/**
 * Bind the gateway, retrying on `port + 1` when the port is held by a
 * third-party process.
 *
 * Why this is the right layer: {@link startServer} acquires the single-instance
 * lock *before* listening, so by the time we reach `listen` a live liora server
 * would already have thrown `ServerLockedError`. Any `EADDRINUSE` here is
 * therefore a third-party listener, and bumping the port is the desired policy
 * ("if the port is taken by something other than liora server itself, +1").
 *
 * Port `0` (OS-assigned ephemeral) is never retried: the kernel already picks a
 * free port, so `EADDRINUSE` cannot arise from a specific-port conflict.
 */
export async function listenWithPortRetry(
  opts: ListenWithPortRetryOptions,
): Promise<{ address: string; port: number }> {
  // Ephemeral bind: the OS chooses a free port, so there is nothing to retry.
  if (opts.port === 0) {
    const address = await opts.gateway.listen(opts.host, 0);
    return { address, port: 0 };
  }

  const maxRetries = opts.maxRetries ?? PORT_RETRY_LIMIT;
  let port = opts.port;
  for (let attempt = 0; ; attempt++) {
    try {
      const address = await opts.gateway.listen(opts.host, port);
      if (port !== opts.port) {
        opts.logger.warn(
          { requestedPort: opts.port, port, host: opts.host },
          'requested port was busy; server bound to a higher port',
        );
      }
      return { address, port };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EADDRINUSE' || attempt >= maxRetries || port >= 65535) {
        throw error;
      }
      const next = port + 1;
      opts.logger.warn(
        { host: opts.host, port, next },
        'port in use by another process, trying next port',
      );
      port = next;
    }
  }
}
