import type {
  ResearchSearchProviderConfig,
  ResearchSearchProviderKind,
} from '#/config/schema';
import type { WebSearchProvider } from '../builtin/web/web-search';
import { CodexWebSearchProvider } from './codex-extras';
import { LocalWebSearchProvider } from './local-web-search';
import { MoonshotWebSearchProvider } from './moonshot-web-search';
import { ZaiWebSearchProvider } from './zai-web-search';
import {
  BingSearchAdapter,
  BraveSearchAdapter,
  DuckDuckGoInstantAnswerSearchAdapter,
  ExaSearchAdapter,
  GoogleCseSearchAdapter,
  SearxngSearchAdapter,
  SerperSearchAdapter,
  TavilySearchAdapter,
} from './research-search-adapters';
import {
  detectSearchProviderEnvKeys,
  resolveGoogleCseCx,
  resolveResearchApiKey,
} from './research-search-env';
import { resolveResearchSearchFreeFallback } from './research-search-free-fallback';
import type {
  ResearchSearchEngineOptions,
  ResearchSearchProviderStatus,
} from './research-search-types';

export interface ProviderSlot {
  readonly id: string;
  readonly kind: ResearchSearchProviderKind;
  readonly label: string;
  readonly source: ResearchSearchProviderStatus['source'];
  readonly weight: number;
  readonly rpm: number | undefined;
  readonly provider: WebSearchProvider;
  cooldownUntil: number;
  useCount: number;
  keyCursor: number;
}

type ProviderConfigWithHint = ResearchSearchProviderConfig & {
  readonly sourceHint?: ResearchSearchProviderStatus['source'];
};

export function buildProviderSlots(options: ResearchSearchEngineOptions): ProviderSlot[] {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const configured = options.search?.providers ?? [];
  const disabledEnvKinds = new Set(options.disabledEnvKinds ?? []);
  const envDetected = detectSearchProviderEnvKeys().filter((c) => !disabledEnvKinds.has(c.kind));
  const merged = mergeProviderConfigs(configured, envDetected);

  const slots: ProviderSlot[] = [];
  let index = 0;

  for (const config of merged) {
    if (config.enabled === false) continue;
    const apiKey = resolveResearchApiKey(config);
    if (needsApiKey(config.kind) && apiKey === undefined) continue;
    if (config.kind === 'google_cse' && resolveGoogleCseCx(config) === undefined) continue;

    const provider = createRemoteProvider(config, apiKey, fetchImpl, options);
    if (provider === undefined) continue;

    slots.push({
      id: `${config.kind}:${String(index)}`,
      kind: config.kind,
      label: config.label ?? config.kind,
      source: config.sourceHint ?? 'config',
      weight: config.weight ?? 1,
      rpm: config.rpm,
      provider,
      cooldownUntil: 0,
      useCount: 0,
      keyCursor: 0,
    });
    index += 1;
  }

  // Moonshot managed search (if configured) as a paid-tier peer.
  if (options.moonshot?.baseUrl !== undefined) {
    slots.push({
      id: `moonshot:${String(index)}`,
      kind: 'moonshot',
      label: 'moonshot',
      source: 'moonshot',
      weight: 1,
      rpm: undefined,
      provider: new MoonshotWebSearchProvider({
        baseUrl: options.moonshot.baseUrl,
        apiKey: options.moonshot.apiKey,
        defaultHeaders: options.moonshot.defaultHeaders,
        customHeaders: options.moonshot.customHeaders,
        tokenProvider: options.moonshot.tokenProvider,
        fetchImpl,
      }),
      cooldownUntil: 0,
      useCount: 0,
      keyCursor: 0,
    });
    index += 1;
  }

  // OpenAI Codex (ChatGPT subscription) search via OAuth bearer.
  if (options.codex?.tokenProvider !== undefined) {
    slots.push({
      id: `codex:${String(index)}`,
      kind: 'codex',
      label: 'codex',
      source: 'config',
      weight: 1,
      rpm: undefined,
      provider: new CodexWebSearchProvider({
        tokenProvider: options.codex.tokenProvider,
        ...(options.codex.baseUrl !== undefined ? { baseUrl: options.codex.baseUrl } : {}),
        ...(options.codex.model !== undefined ? { model: options.codex.model } : {}),
        fetchImpl,
      }),
      cooldownUntil: 0,
      useCount: 0,
      keyCursor: 0,
    });
    index += 1;
  }

  // Free local fallback always available unless explicitly disabled with advanced override.
  if (resolveResearchSearchFreeFallback(options.search?.freeFallback)) {
    slots.push({
      id: `duckduckgo_ia:${String(index)}`,
      kind: 'duckduckgo_ia',
      label: 'duckduckgo_ia',
      source: 'local',
      weight: 1,
      rpm: undefined,
      provider: new DuckDuckGoInstantAnswerSearchAdapter(fetchImpl),
      cooldownUntil: 0,
      useCount: 0,
      keyCursor: 0,
    });
    index += 1;

    const local = new LocalWebSearchProvider({
      ...options.local,
      fetchImpl,
      urlFetcher: options.urlFetcher ?? options.local?.urlFetcher,
    });
    slots.push({
      id: `duckduckgo:${String(index)}`,
      kind: 'duckduckgo',
      label: 'duckduckgo',
      source: 'local',
      weight: 1,
      rpm: undefined,
      provider: local,
      cooldownUntil: 0,
      useCount: 0,
      keyCursor: 0,
    });
  }

  return slots;
}

function mergeProviderConfigs(
  configured: readonly ResearchSearchProviderConfig[],
  envDetected: readonly ResearchSearchProviderConfig[],
): ProviderConfigWithHint[] {
  const out: ProviderConfigWithHint[] = configured.map((c) => ({ ...c, sourceHint: 'config' as const }));
  const configuredKinds = new Set(configured.map((c) => c.kind));
  for (const env of envDetected) {
    if (configuredKinds.has(env.kind)) continue;
    out.push({ ...env, sourceHint: 'env' });
  }
  return out;
}

function needsApiKey(kind: ResearchSearchProviderKind): boolean {
  return (
    kind === 'brave' ||
    kind === 'tavily' ||
    kind === 'exa' ||
    kind === 'serper' ||
    kind === 'google_cse' ||
    kind === 'bing' ||
    kind === 'zai'
  );
}

function createRemoteProvider(
  config: ResearchSearchProviderConfig,
  apiKey: string | undefined,
  fetchImpl: typeof fetch,
  options: ResearchSearchEngineOptions,
): WebSearchProvider | undefined {
  switch (config.kind) {
    case 'brave':
      if (apiKey === undefined) return undefined;
      return new BraveSearchAdapter(apiKey, fetchImpl);
    case 'tavily':
      if (apiKey === undefined) return undefined;
      return new TavilySearchAdapter(apiKey, fetchImpl);
    case 'exa':
      if (apiKey === undefined) return undefined;
      return new ExaSearchAdapter(apiKey, fetchImpl);
    case 'serper':
      if (apiKey === undefined) return undefined;
      return new SerperSearchAdapter(apiKey, fetchImpl);
    case 'google_cse': {
      if (apiKey === undefined) return undefined;
      const cx = resolveGoogleCseCx(config);
      if (cx === undefined) return undefined;
      return new GoogleCseSearchAdapter(apiKey, cx, fetchImpl);
    }
    case 'bing':
      if (apiKey === undefined) return undefined;
      return new BingSearchAdapter(apiKey, fetchImpl);
    case 'zai':
      if (apiKey === undefined) return undefined;
      return new ZaiWebSearchProvider({
        apiKey,
        ...(config.baseUrl !== undefined ? { baseUrl: config.baseUrl } : {}),
        fetchImpl,
      });
    case 'searxng': {
      const baseUrl = config.baseUrl ?? options.local?.searxngUrl;
      if (baseUrl === undefined) return undefined;
      return new SearxngSearchAdapter(baseUrl, fetchImpl);
    }
    case 'duckduckgo_ia':
      return new DuckDuckGoInstantAnswerSearchAdapter(fetchImpl);
    case 'duckduckgo':
      return new LocalWebSearchProvider({
        ...options.local,
        fetchImpl,
        urlFetcher: options.urlFetcher,
      });
    case 'moonshot':
      // Handled via options.moonshot in buildProviderSlots.
      return undefined;
    case 'codex':
      // Handled via options.codex in buildProviderSlots (OAuth, no API key).
      return undefined;
    default:
      return undefined;
  }
}
