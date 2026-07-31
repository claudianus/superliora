/**
 * Runtime tool-services factory — extracted from core-impl.ts.
 *
 * Responsible for constructing the `ToolServices` bundle (web search, URL
 * fetch, browser-use, computer-use, xAI Grok) from the resolved LioraConfig.
 */

import { createBrowserUseRuntime, CuaComputerRuntime } from '@superliora/gui-use';
import { join } from 'pathe';

import { LocalFetchURLProvider } from '#/tools/providers/local-fetch-url';
import { LocalWebSearchProvider } from '#/tools/providers/local-web-search';
import { resolveSearxngUrl } from '#/tools/providers/research-meta-status';
import { MoonshotFetchURLProvider } from '#/tools/providers/moonshot-fetch-url';
import { ensureResearchBridgeSidecar } from '#/tools/providers/research-bridge-sidecar';
import { isResearchBridgeEnabled } from '#/tools/providers/research-bridge-status';
import {
  ResearchSearchEngine,
  createBrowserSearchChannel,
  createChromeExtensionSearchChannel,
} from '#/tools/providers/research-search';
import {
  PreferXaiGrokWebSearchProvider,
  XaiGrokBuildClient,
  XaiGrokWebSearchProvider,
  createXaiGrokBuildClientFromEnv,
} from '#/tools/providers/xai-grok-build';
import type { LioraConfig, MoonshotServiceConfig } from '../config';
import type { CircuitBreakerRegistry } from '../runtime/circuit-breaker';
import type { BearerTokenProvider, OAuthTokenProviderResolver } from '../session/provider/provider-manager';
import type { ToolServices } from '../tools/support/services';
import {
  SUPERLIORA_PROVIDER_NAME,
  XAI_PROFILE,
  isXaiGrokBuildBaseUrl,
  resolveXaiGrokRoute,
  xaiGrokBuildRequestHeaders,
  xaiGrokRouteConfig,
} from '@superliora/oauth';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function createRuntimeConfig(input: {
  readonly config: LioraConfig;
  readonly homeDir?: string | undefined;
  readonly kimiRequestHeaders?: Record<string, string> | undefined;
  readonly resolveOAuthTokenProvider?: OAuthTokenProviderResolver | undefined;
  readonly circuitBreakers?: CircuitBreakerRegistry | undefined;
  readonly onCircuitBreakerChanged?: (() => void) | undefined;
}): Promise<ToolServices> {
  const localFetcher = new LocalFetchURLProvider();
  const localSearch = input.config.research?.localSearch;
  const localOptions = {
    urlFetcher: localFetcher,
    concurrency: localSearch?.concurrency,
    timeoutMs: localSearch?.timeoutMs,
    searxngUrl: resolveSearxngUrl(process.env, localSearch?.searxngUrl),
    yacyUrl: localSearch?.yacyUrl,
    directSources: localSearch?.directSources,
    offlineMode: localSearch?.offlineMode,
    cachePath:
      input.homeDir === undefined
        ? undefined
        : join(input.homeDir, 'research', 'local-search.sqlite'),
  };
  const localSearcher =
    localSearch?.enabled === false ? undefined : new LocalWebSearchProvider(localOptions);
  const searchService = input.config.services?.moonshotSearch;
  const fetchService = input.config.services?.moonshotFetch;
  const moonshotCreds =
    searchService === undefined
      ? undefined
      : serviceCredentials(searchService, input.resolveOAuthTokenProvider);
  const browserUseEnabled = input.config.browserUse?.enabled !== false;
  const browserUse =
    input.config.browserUse?.enabled === false
      ? undefined
      : createBrowserUseRuntime({
          provider: input.config.browserUse?.provider,
          fallbackProvider: input.config.browserUse?.fallbackProvider,
          fallbackEnabled: input.config.browserUse?.fallbackEnabled,
          autoInstall: input.config.browserUse?.autoInstall,
          autoUpdate: input.config.browserUse?.autoUpdate,
          cacheDir: input.config.browserUse?.cacheDir,
          binaryPath: input.config.browserUse?.binaryPath,
          version: input.config.browserUse?.version,
          licenseKeyEnv: input.config.browserUse?.licenseKeyEnv,
          host: input.config.browserUse?.host,
          port: input.config.browserUse?.port,
          obeyRobots: input.config.browserUse?.obeyRobots,
          disableHostVerification: input.config.browserUse?.disableHostVerification,
        });
  const browserChannel = await createBrowserSearchChannel(browserUse, browserUseEnabled);
  if (isResearchBridgeEnabled()) {
    await ensureResearchBridgeSidecar();
  }
  const chromeExtensionChannel = createChromeExtensionSearchChannel();
  const researchSearcher =
    localSearch?.enabled === false
      ? undefined
      : new ResearchSearchEngine({
          search: input.config.research?.search,
          local: localOptions,
          urlFetcher: localFetcher,
          browserChannel,
          chromeExtensionChannel,
          circuitBreakers: input.circuitBreakers,
          onCircuitBreakerChanged: input.onCircuitBreakerChanged,
          moonshot:
            searchService?.baseUrl === undefined
              ? undefined
              : {
                  baseUrl: searchService.baseUrl,
                  apiKey: moonshotCreds?.apiKey,
                  defaultHeaders: input.kimiRequestHeaders,
                  customHeaders: searchService.customHeaders,
                  tokenProvider: moonshotCreds?.tokenProvider,
                },
        });

  const xaiGrokBuild = resolveXaiGrokBuildClient(
    input.config,
    input.resolveOAuthTokenProvider,
  );
  const xaiWebSearcher =
    xaiGrokBuild === undefined ? undefined : new XaiGrokWebSearchProvider(xaiGrokBuild);
  const fallbackSearcher = researchSearcher ?? localSearcher;
  const preferXai = input.config.research?.search?.preferXai !== false;
  const webSearcher =
    xaiWebSearcher === undefined
      ? fallbackSearcher
      : !preferXai
        ? (fallbackSearcher ?? xaiWebSearcher)
        : fallbackSearcher === undefined
          ? xaiWebSearcher
          : new PreferXaiGrokWebSearchProvider(xaiWebSearcher, fallbackSearcher);

  return {
    urlFetcher:
      fetchService?.baseUrl === undefined
        ? localFetcher
        : new MoonshotFetchURLProvider({
            baseUrl: fetchService.baseUrl,
            localFallback: localFetcher,
            defaultHeaders: input.kimiRequestHeaders,
            ...serviceCredentials(fetchService, input.resolveOAuthTokenProvider),
          }),
    webSearcher,
    xaiGrokBuild,
    browserUse,
    computerUse:
      input.config.computerUse?.enabled === false
        ? undefined
        : new CuaComputerRuntime({
            autoInstall: input.config.computerUse?.autoInstall,
            driverCmd: input.config.computerUse?.driverCmd,
          }),
  };
}

export function hasStatefulGuiRuntime(config: LioraConfig): boolean {
  return config.browserUse?.enabled !== false || config.computerUse?.enabled !== false;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveXaiGrokBuildClient(
  config: LioraConfig,
  resolveOAuthTokenProvider: OAuthTokenProviderResolver | undefined,
): XaiGrokBuildClient | undefined {
  const provider =
    config.providers['xai-grok'] ??
    config.providers[XAI_PROFILE.id] ??
    undefined;

  const envKey = nonEmptyString(process.env['XAI_API_KEY']);
  const configKey = provider === undefined ? undefined : nonEmptyString(provider.apiKey);
  const apiKey = configKey ?? envKey;

  const oauthRef =
    provider?.oauth ??
    (provider?.oauths !== undefined && provider.oauths.length > 0
      ? provider.oauths[0]
      : undefined);
  const tokenProvider =
    oauthRef === undefined
      ? undefined
      : resolveOAuthTokenProvider?.('xai-grok', oauthRef) ??
        resolveOAuthTokenProvider?.(XAI_PROFILE.id, oauthRef);

  if (apiKey === undefined && tokenProvider === undefined) {
    // Still allow env-only client construction for CI/scripts.
    return createXaiGrokBuildClientFromEnv();
  }

  const configuredBaseUrl =
    nonEmptyString(provider?.baseUrl) ?? nonEmptyString(process.env['XAI_BASE_URL']);
  const routeKind = resolveXaiGrokRoute(configuredBaseUrl);
  const route = xaiGrokRouteConfig(routeKind);
  const baseUrl = configuredBaseUrl ?? route.baseUrl;
  const customHeaders = {
    ...provider?.customHeaders,
    ...route.customHeaders,
    ...(isXaiGrokBuildBaseUrl(baseUrl) ? xaiGrokBuildRequestHeaders() : {}),
  };

  return new XaiGrokBuildClient({
    baseUrl,
    apiKey,
    tokenProvider,
    customHeaders,
  });
}

function serviceCredentials(
  service: MoonshotServiceConfig,
  resolveOAuthTokenProvider: OAuthTokenProviderResolver | undefined,
): {
  readonly apiKey?: string | undefined;
  readonly tokenProvider?: BearerTokenProvider | undefined;
  readonly customHeaders?: Record<string, string> | undefined;
} {
  const apiKey = nonEmptyString(service.apiKey);
  return {
    apiKey,
    tokenProvider:
      service.oauth !== undefined
        ? resolveOAuthTokenProvider?.(SUPERLIORA_PROVIDER_NAME, service.oauth)
        : undefined,
    customHeaders: service.customHeaders,
  };
}

function nonEmptyString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}
