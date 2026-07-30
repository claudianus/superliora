import {
  InstantiationService,
  resolveConfigPath,
  resolveLioraHome,
  IEnvironmentService,
  SessionStore,
} from '@superliora/agent-core';
import Fastify from 'fastify';

import { IRestGateway } from '#/services/gateway';

import { installErrorHandler } from '../error-handler';
import { acquireLock, ServerLockedError } from '../lock';
import { createAuthHook } from '#/middleware/auth';
import { createAuthFailureLimiter } from '#/middleware/rateLimit';
import {
  createHostCheck,
  isHostCheckDisabled,
  parseAllowedHosts,
} from '#/middleware/hostnames';
import { createOriginHook, parseCorsOrigins } from '#/middleware/origin';
import { createServerLogger } from '../services/pinoLoggerService';
import { resolveRequestId } from '../request-id';
import { registerApiV1Routes } from '../routes/registerApiV1Routes';
import { createServerServiceCollection } from '#/services/serviceCollection';
import {
  createAuthTokenService,
  IAuthTokenService,
} from '#/services/auth/authTokenService';
import { resolvePasswordHash } from '#/services/auth/password';
import { createSecurityHeadersHook } from '#/services/auth/securityHeaders';
import { createTokenStore } from '#/services/auth/tokenStore';
import { getServerVersion } from '../version';
import { enforceBindGate } from './bind-gate';
import { cleanupBootFailure } from './boot-cleanup';
import { wireCoreProcessServices } from './core-wiring';
import { listenWithPortRetry } from './listen';
import { registerMetaDocumentRoutes, registerServerOpenApi } from './openapi';
import {
  createServerCloser,
  registerDefaultShutdownService,
} from './shutdown';

export type { ServerStartOptions, RunningServer } from './types';
export { ServerLockedError };
export {
  listenWithPortRetry,
  PORT_RETRY_LIMIT,
  type ListenWithPortRetryOptions,
} from './listen';

import type { ServerStartOptions, RunningServer } from './types';

export async function startServer(opts: ServerStartOptions): Promise<RunningServer> {
  const pinoLogger =
    opts.logger ?? createServerLogger({ level: opts.logLevel ?? 'info' });

  const lockHandle = acquireLock({
    port: opts.port,
    host: opts.host,
    lockPath: opts.lockPath,
    // Record the host build identity so `liora server status` can detect a
    // build-mismatched server.
    hostVersion: opts.coreProcessOptions?.identity?.version,
    entry: process.argv[1],
  });

  const app = Fastify({
    loggerInstance: pinoLogger,
    disableRequestLogging: false,
    genReqId: (req) => resolveRequestId(req.headers),
  });

  app.setValidatorCompiler(() => () => true);
  app.setSerializerCompiler(() => (data) => JSON.stringify(data));
  installErrorHandler(app);

  // Host / Origin checks (ROADMAP M4.3). Registered before any route so they
  // run ahead of every handler and ahead of the (future, M5.1) auth hook.
  // Host is evaluated before Origin; both are uniform across bindings (PLAN
  // D3) — even on loopback — so behavior does not depend on how the server is
  // reached. The default-allow set keeps `app.inject` (`Host: localhost:80`)
  // and real `fetch` to `127.0.0.1:<port>` working.
  const allowedHosts = [...parseAllowedHosts(process.env), ...(opts.allowedHosts ?? [])];
  const hostCheck = createHostCheck({
    boundHost: opts.host,
    extra: allowedHosts,
    disable: isHostCheckDisabled(process.env),
  });
  const originHook = createOriginHook({ allowedOrigins: parseCorsOrigins(process.env) });
  app.addHook('onRequest', hostCheck.onRequest);
  app.addHook('onRequest', originHook);

  const serverVersion = opts.coreProcessOptions?.identity?.version ?? getServerVersion();

  await registerServerOpenApi(app, serverVersion);

  const envService: IEnvironmentService = {
    _serviceBrand: undefined,
    homeDir: resolveLioraHome(opts.coreProcessOptions?.homeDir),
    configPath: resolveConfigPath({
      homeDir: opts.coreProcessOptions?.homeDir,
      configPath: opts.coreProcessOptions?.configPath,
    }),
  };

  // Sessions can exist on disk but be missing from session_index.jsonl (e.g. after
  // a crash between mkdir and index append). Rebuild the index at boot so they
  // show up in the web UI even though their directory still exists. Repairing here keeps
  // the request path scan-free. Best-effort: never blocks startup on failure.
  try {
    const stats = await new SessionStore(envService.homeDir).reindex();
    pinoLogger.info(stats, 'session index rebuilt');
  } catch (error) {
    pinoLogger.warn({ err: String(error) }, 'session index rebuild failed (best-effort)');
  }

  // Token auth (ROADMAP M5.1). The real `IAuthTokenService` needs an
  // async-built `TokenStore` over the persistent `<homeDir>/server.token`
  // (0600; generated once on first boot and reused across restarts) and an
  // optional bcrypt password hash — both awaited here, then supplied to the
  // collection via `serviceOverrides` so tests can inject a fixed-token impl
  // that wins (last-wins) over this default. The store re-reads the file when
  // its mtime changes, so `liora server rotate-token` takes effect without a
  // restart; the file is intentionally kept on shutdown (dispose is a no-op).
  const tokenStore = await createTokenStore(envService.homeDir);
  const passwordHash = await resolvePasswordHash(process.env);
  const defaultAuth = createAuthTokenService({ tokenStore, passwordHash });

  const bootCleanup = { tokenStore, lockHandle };
  const { bindClass } = await enforceBindGate(opts, {
    tokenStore,
    passwordHash,
    logger: pinoLogger,
    releaseLock: () => lockHandle.release(),
  });

  const services = createServerServiceCollection({
    server: {
      ...opts,
      // WS Host/Origin defaults (ROADMAP M4.3 / M5.1): mirror the HTTP checks
      // on the upgrade path. Caller-supplied values win (used by the
      // host-origin e2e tests). `authTokenService` is NOT threaded here — it
      // reaches the WS gateway via `setAuthTokenService` below so the
      // override-aware impl enforces auth.
      wsGatewayOptions: {
        ...opts.wsGatewayOptions,
        hostCheck: opts.wsGatewayOptions?.hostCheck ?? {
          boundHost: opts.host,
          extra: allowedHosts,
          disable: isHostCheckDisabled(process.env),
        },
        allowedOrigins:
          opts.wsGatewayOptions?.allowedOrigins ?? parseCorsOrigins(process.env),
      },
      serviceOverrides: [
        [IAuthTokenService, defaultAuth],
        ...(opts.serviceOverrides ?? []),
      ],
    },
    app,
    pinoLogger,
    envService,
  });
  const ix = new InstantiationService(services);

  // Auth hook (ROADMAP M5.1). Registered after Host/Origin (above) and before
  // routes, so a rejected request never reaches a handler. Resolved from the
  // container so a test-injected fixed-token impl is what enforces auth.
  //
  // Auth-failure rate limit (ROADMAP M6.4): only on a non-loopback bind, where
  // brute-force attempts are reachable from the network. Loopback keeps the
  // original "no limiter" behavior so local retries are never throttled.
  const authTokenService = ix.invokeFunction((a) => a.get(IAuthTokenService));
  const authFailureLimiter =
    bindClass !== 'loopback' ? createAuthFailureLimiter() : undefined;
  app.addHook('onRequest', createAuthHook(authTokenService, { limiter: authFailureLimiter }));

  // Security response headers (ROADMAP M6.6): only on a non-loopback bind.
  // TLS is terminated by a reverse proxy in this phase, so HSTS is omitted
  // here (`tls: false`) — the proxy is responsible for setting it.
  if (bindClass !== 'loopback') {
    app.addHook('onSend', createSecurityHeadersHook({ tls: false }));
  }

  // Bind classification (`bindClass`, computed above next to the password/TLS
  // gate) drives every hardening decision from here on: debug routes now;
  // rate limit, dangerous endpoints, and security headers in M6.4–M6.6.

  // Debug routes (ROADMAP M5.3): only mount `/api/v1/debug/*` when bound to a
  // loopback interface. On a non-loopback bind these introspection/mutation
  // endpoints would be reachable from the network, so suppress them even if
  // the caller asked for them, and warn so the operator knows.
  if (opts.debugEndpoints === true && bindClass !== 'loopback') {
    pinoLogger.warn(
      { host: opts.host, bindClass },
      'debug endpoints suppressed: refusing to mount /api/v1/debug/* on a non-loopback bind',
    );
  }

  // Dangerous-endpoint downgrade (ROADMAP M6.5): on a non-loopback bind the
  // shutdown + terminals routes are NOT registered (404) unless the operator
  // explicitly opts in. Loopback always mounts them (backward compatible).
  const allowRemoteShutdown = opts.allowRemoteShutdown === true;
  const allowRemoteTerminals = opts.allowRemoteTerminals === true;
  await registerApiV1Routes(app, ix, {
    serverVersion,
    debugEndpoints: opts.debugEndpoints === true && bindClass === 'loopback',
    enableShutdown: bindClass === 'loopback' || allowRemoteShutdown,
    enableTerminals: bindClass === 'loopback' || allowRemoteTerminals,
  });

  registerMetaDocumentRoutes(app, serverVersion, opts.host);

  try {
    await app.ready();
  } catch (error) {
    await cleanupBootFailure(bootCleanup);
    throw error;
  }

  let coreProcess;
  let modelCatalogRefreshScheduler;
  try {
    ({ coreProcess, modelCatalogRefreshScheduler } = wireCoreProcessServices(
      ix,
      services,
      authTokenService,
    ));
  } catch (error) {
    await cleanupBootFailure({ ...bootCleanup, ix });
    throw error;
  }

  try {
    await coreProcess.ready();
  } catch (error) {
    await cleanupBootFailure({ ...bootCleanup, ix });
    throw error;
  }
  pinoLogger.info('core process ready');
  modelCatalogRefreshScheduler?.start().catch((err) => {
    pinoLogger.warn({ err }, 'failed to start provider model catalog refresh scheduler');
  });

  let address: string;
  let boundPort: number;
  try {
    ({ address, port: boundPort } = await listenWithPortRetry({
      gateway: ix.invokeFunction((a) => a.get(IRestGateway)),
      host: opts.host,
      port: opts.port,
      logger: pinoLogger,
    }));
  } catch (error) {
    await cleanupBootFailure({ ...bootCleanup, ix });
    throw error;
  }
  // If we retried onto a different port, advertise the real one in the lock so
  // `liora server status` / `kill` / `ps` can find this daemon.
  if (boundPort !== opts.port) {
    lockHandle.updatePort(boundPort);
  }
  pinoLogger.info(
    { address, port: boundPort, lockPath: lockHandle.lockPath },
    'server listening',
  );

  const closerOpts = {
    ix,
    app,
    tokenStore,
    lockHandle,
    authFailureLimiter,
    logger: pinoLogger,
    serviceOverrides: opts.serviceOverrides,
    services,
  };
  const doClose = createServerCloser(closerOpts);
  registerDefaultShutdownService(closerOpts, doClose);

  return {
    address,
    logger: pinoLogger,
    services: ix,
    close: doClose,
  };
}
