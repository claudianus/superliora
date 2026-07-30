import type { BindClass } from '#/services/auth/bindClassify';
import { classify } from '#/services/auth/bindClassify';
import type { TokenStore } from '#/services/auth/tokenStore';
import type { ServerLogger } from './services/pinoLoggerService';
import type { ServerStartOptions } from './start-types';

export interface BindGateContext {
  bindClass: BindClass;
}

/**
 * Public-bind hardening gate (ROADMAP M6.3). Classify the bind host and, for
 * any non-loopback tier (LAN or public), refuse to start unless the operator
 * explicitly acknowledged that TLS is terminated elsewhere (`insecureNoTls`).
 */
export async function enforceBindGate(
  opts: Pick<ServerStartOptions, 'host' | 'bindClass' | 'insecureNoTls'>,
  deps: {
    tokenStore: TokenStore;
    passwordHash: string | undefined;
    logger: ServerLogger;
    releaseLock: () => void;
  },
): Promise<BindGateContext> {
  const bindClass = classify(opts.host, { bindClass: opts.bindClass });
  if (bindClass !== 'loopback') {
    const refusePublicBind = async (message: string): Promise<never> => {
      try {
        await deps.tokenStore.dispose();
      } catch {
        // best-effort cleanup of the token file on boot refusal
      }
      deps.releaseLock();
      throw new Error(message);
    };
    if (opts.insecureNoTls !== true) {
      await refusePublicBind(
        'Refusing to bind a non-loopback host without TLS. ' +
          'Put the server behind a TLS-terminating reverse proxy (Caddy/nginx), ' +
          'or pass --insecure-no-tls to acknowledge the risk.',
      );
    }
    if (deps.passwordHash === undefined) {
      deps.logger.warn(
        { host: opts.host, bindClass },
        'binding non-loopback host with token-only auth (no SUPERLIORA_PASSWORD) — the bearer token printed in the startup banner is the only credential protecting this server',
      );
    }
    deps.logger.warn(
      { host: opts.host, bindClass },
      'binding non-loopback host without TLS — use a reverse proxy or tunnel in production',
    );
  }
  return { bindClass };
}
