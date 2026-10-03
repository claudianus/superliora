/**
 * `CoreProcessService` — implementation of `ICoreProcessService`.
 */

import { createRPC, LioraCore } from '../../rpc';
import { Disposable, registerSingleton, SyncDescriptor } from '../../di';
import type { CoreAPI, CoreRPC, SDKAPI } from '../../rpc';
import type { OAuthTokenProviderResolver } from '../../session/provider/provider-manager';
import {
  createKimiDefaultHeaders,
} from '@superliora/oauth';

import { createManagedAuthFacade } from '../auth/managedAuth';
import { BridgeClientAPI } from './coreProcessClient';
import { IApprovalService } from '../approval/approval';
import { IEnvironmentService } from '../environment/environment';
import { IEventService } from '../event/event';
import { ILogService } from '../logger/logger';
import { IQuestionService } from '../question/question';
import { ICoreProcessService, type CoreProcessServiceOptions } from './coreProcess';

export class CoreProcessService extends Disposable implements ICoreProcessService {
  readonly _serviceBrand: undefined;

  /**
   * Service-facing RPC handle. This is a `Proxy` over the awaited
   * `RPCMethods<CoreAPI>` so callers don't have to await a promise themselves
   * — `core.rpc.createSession({...})` returns a `Promise<SessionSummary>`
   * directly. After dispose, the proxy rejects on every method invocation.
   */
  public readonly rpc: CoreRPC;

  /**
   * The in-process `LioraCore` instance. Kept private so daemon-side code can't
   * grab it and bypass the peer-service indirection.
   */
  private readonly _core: LioraCore;

  /**
   * Promise that resolves to the resolved RPC methods. The `rpc` proxy awaits
   * this on every dispatch (cheap — controlled-promise resolves synchronously
   * on the second call).
   */
  private readonly _coreRpcPromise: Promise<CoreRPC>;

  private readonly _ready: Promise<void>;
  private _closing = false;
  private _shutdown: Promise<void> | undefined;
  private readonly _pendingCalls = new Set<Promise<unknown>>();

  constructor(
    options: CoreProcessServiceOptions,
    @IEnvironmentService env: IEnvironmentService,
    @IEventService eventService: IEventService,
    @IApprovalService approvalService: IApprovalService,
    @IQuestionService questionService: IQuestionService,
    @ILogService private readonly logService: ILogService,
  ) {
    super();

    // 1. Build the in-process RPC pair. Left/Right are typed; `coreRpc` is the
    //    function LioraCore receives, `sdkRpc` is the one we satisfy.
    const [coreRpc, sdkRpc] = createRPC<CoreAPI, SDKAPI>();

    // Default-wire the OAuth token resolver. Without this, LioraCore's
    // `ProviderManager.resolveAuth` sees `resolveOAuthTokenProvider ===
    // undefined` and synthesizes a closure that ALWAYS throws
    // `AUTH_LOGIN_REQUIRED` — even after a successful device-code login that
    // persisted a fresh token to disk. The daemon's `/auth` readiness probe
    // is a different code path (file existence on the credentials store) so
    // it stays green; the failure only surfaces inside the prompt turn, as
    // an `auth.login_required` error after `turn.step.started`. We bridge
    // the gap by default-constructing a managed auth facade against the same
    // home + config paths LioraCore will use, and handing its
    // `resolveOAuthTokenProvider` into the core. Callers (e.g. node-sdk
    // tests) can still override via `options.resolveOAuthTokenProvider`.
    const resolveOAuthTokenProvider: OAuthTokenProviderResolver =
      options.resolveOAuthTokenProvider ??
      createManagedAuthFacade({
        homeDir: env.homeDir,
        configPath: env.configPath,
      }).resolveOAuthTokenProvider;

    // Default-wire the Kimi request headers (User-Agent + X-Msh-* device
    // identity). Without this, LioraCore's outbound fetch carries the
    // default Node fetch User-Agent and the managed Kimi-for-Coding
    // endpoint rejects with 40340 ("only available for Coding Agents
    // such as Kimi CLI, Claude Code, …"). Mirrors what `SDKRpcClient`
    // does for the in-process TUI path (node-sdk's sdk-rpc-client.ts).
    // Caller-supplied `kimiRequestHeaders` always wins; absent that, we
    // synthesize from `options.identity`. Hosts that pass neither
    // (no identity, no headers) still construct — but their requests will
    // trip the 40340 guard.
    const kimiRequestHeaders: Record<string, string> | undefined =
      options.kimiRequestHeaders ??
      (options.identity === undefined ? undefined : createKimiDefaultHeaders({
        homeDir: env.homeDir,
        ...options.identity,
      }));

    // `appVersion` flows into Session records (`app_version`) and tool
    // call ctx. Prefer explicit > identity.version so callers can pin
    // a different value if they need to.
    const appVersion: string | undefined =
      options.appVersion ?? options.identity?.version;

    // 2. Construct the core. LioraCore's ctor wires itself into `coreRpc` and
    //    exposes `this.sdk: Promise<SDKRPC>` for the reverse direction.
    this._core = new LioraCore(coreRpc, {
      ...options,
      homeDir: env.homeDir,
      configPath: env.configPath,
      kimiRequestHeaders,
      appVersion,
      resolveOAuthTokenProvider,
    });

    // 3. Satisfy the SDK side with a BridgeClientAPI that routes to peer services.
    //    sdkRpc returns Promise<RPCMethods<CoreAPI>> — these are the methods
    //    in-package services will dispatch on.
    const clientApi = new BridgeClientAPI({
      eventService,
      approvalService,
      questionService,
      logService,
    });
    this._coreRpcPromise = sdkRpc(clientApi);

    // Both directions are bound; native configuration loaded in the constructor.
    this._ready = this._coreRpcPromise.then(() => undefined);

    // 5. Build the dispatch proxy. Each method on the proxy awaits the resolved
    //    RPC methods then forwards. After dispose, dispatch rejects eagerly.
    this.rpc = this._buildRpcProxy();
  }

  async ready(): Promise<void> {
    return this._ready;
  }

  shutdown(): Promise<void> {
    if (this._shutdown !== undefined) return this._shutdown;
    this._closing = true;
    const completion = Promise.withResolvers<void>();
    this._shutdown = completion.promise;
    void this._close().then(completion.resolve, completion.reject);
    return this._shutdown;
  }

  private async _close(): Promise<void> {
    try {
      await this._core.close();
    } finally {
      await Promise.allSettled(this._pendingCalls);
    }
    super.dispose();
  }

  override dispose(): void {
    void this.shutdown().catch((error: unknown) => {
      this.logService.error({ error }, 'native core shutdown failed');
    });
  }

  private _buildRpcProxy(): CoreRPC {
    const rpcPromise = this._coreRpcPromise;

    // We don't know the concrete method set at compile time here (CoreAPI is
    // a structural interface; `RPCMethods<CoreAPI>` is a mapped type).
    // The Proxy lets us intercept every property access and return a function
    // that awaits the underlying RPC and forwards.
    return new Proxy({} as CoreRPC, {
      get: (_target, prop) => {
        // Symbols / well-known properties (Symbol.toPrimitive, then-able
        // probe, etc.) should not be RPC-dispatched.
        if (typeof prop !== 'string') return undefined;
        // Returning a function keeps `typeof rpc.foo === 'function'` true,
        // which downstream code may probe.
        return (...args: unknown[]) => {
          if (this._closing) {
            return Promise.reject(new Error('CoreProcessService has been disposed'));
          }
          const call = rpcPromise.then((methods) => {
            if (this._closing) {
              throw new Error('CoreProcessService has been disposed');
            }
            const fn = (methods as unknown as Record<string, unknown>)[prop];
            if (typeof fn !== 'function') {
              throw new TypeError(`CoreProcessService.rpc.${prop} is not a function`);
            }
            return (fn as (...args: unknown[]) => unknown)(...args);
          }).finally(() => {
            this._pendingCalls.delete(call);
          });
          this._pendingCalls.add(call);
          return call;
        };
      },
    });
  }

}

// Self-register under the global singleton registry. Ctor signature is
// `(options, @IEnvironmentService, @IEventService, @IApprovalService,
//  @IQuestionService, @ILogService)` — the leading `options` slot is a pure data bag so we
// register with `[{}]` as a sane default. Daemon-side `start.ts` overrides
// this descriptor via `services.set(ICoreProcessService, new
// SyncDescriptor(CoreProcessService, [opts.coreProcessOptions ?? {}], false))`
// when it has access to the real options bag. Later registrations win — both
// at registry level and at `ServiceCollection` level.
// `supportsDelayedInstantiation = false` preserves current reverse-dispose
// semantics.
registerSingleton(
  ICoreProcessService,
  new SyncDescriptor(CoreProcessService, [{} as CoreProcessServiceOptions], false),
);
