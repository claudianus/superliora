import type {
  CoreProcessServiceOptions,
  InstantiationService,
  ServiceIdentifier,
} from '@superliora/agent-core';

import type { WSGatewayOptions } from '#/services/gateway';
import type { ServerLogLevel, ServerLogger } from './services/pinoLoggerService';

export interface ServerStartOptions {
  host: string;
  port: number;
  logLevel?: ServerLogLevel;

  logger?: ServerLogger;

  lockPath?: string;

  coreProcessOptions?: CoreProcessServiceOptions;

  wsGatewayOptions?: WSGatewayOptions;

  debugEndpoints?: boolean;

  /**
   * Override the classification of a wildcard bind (`0.0.0.0` / `::` / empty).
   * Default (unset) treats wildcards as `public` (most strict); set to `lan`
   * to relax to LAN-tier hardening. See `services/auth/bindClassify.ts`.
   */
  bindClass?: 'lan' | 'public';

  /**
   * Allow a non-loopback bind WITHOUT a TLS-terminating reverse proxy. Default
   * false: binding beyond loopback refuses to start unless this is set, so a
   * public/LAN bind is never served over plain HTTP by accident. Pass
   * `--insecure-no-tls` (or set this) only when you accept the risk.
   */
  insecureNoTls?: boolean;

  /**
   * Allow `POST /api/v1/shutdown` on a non-loopback bind. Default false: the
   * shutdown route is NOT registered (404) on a non-loopback bind unless this is
   * set. Loopback always mounts it.
   */
  allowRemoteShutdown?: boolean;

  /**
   * Allow the PTY `/api/v1/terminals/*` routes on a non-loopback bind. Default
   * false: terminals routes are NOT registered (404) on a non-loopback bind
   * unless this is set (remote shell is the highest-risk surface). Loopback
   * always mounts them.
   */
  allowRemoteTerminals?: boolean;

  /**
   * Extra `Host` header values to allow, in addition to the default allowlist
   * and `SUPERLIORA_ALLOWED_HOSTS`. A leading dot matches a domain suffix.
   */
  allowedHosts?: readonly string[];

  serviceOverrides?: ReadonlyArray<readonly [ServiceIdentifier<unknown>, unknown]>;
}

export interface RunningServer {
  readonly address: string;

  readonly logger: ServerLogger;

  readonly services: InstantiationService;

  close(): Promise<void>;
}
