import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  buildSearchCascadeSessionLiveLines,
  formatSearchCascadeSessionGlance,
} from '../../../utils/search/search-cascade';
import type { AppState } from '../../../types';

/**
 * Local detection of research-search API keys for Settings → Search / Ops.
 * Mirrors agent-core research-search-env without importing agent-core.
 */

export interface SearchEnvStatus {
  readonly configured: readonly string[];
  readonly freeFallback: true;
  readonly hints: readonly string[];
}

/** Routing strategies exposed in Settings → Search (mirrors ResearchSearchRoutingStrategy). */
export type SearchRoutingStrategySetting =
  | 'auto'
  | 'parallel'
  | 'fallback'
  | 'round_robin'
  | 'weighted_round_robin'
  | 'least_used'
  | 'rate_limit_aware';

export const SEARCH_ROUTING_STRATEGY_OPTIONS: readonly {
  readonly value: SearchRoutingStrategySetting;
  readonly label: string;
  readonly description: string;
}[] = [
  {
    value: 'auto',
    label: 'Strategy: auto (recommended)',
    description: 'Cost-aware cascade — escalate only when results are thin.',
  },
  {
    value: 'parallel',
    label: 'Strategy: parallel',
    description: 'Fan-out ready providers (higher recall, burns quota).',
  },
  {
    value: 'fallback',
    label: 'Strategy: fallback',
    description: 'Try providers in order until enough hits.',
  },
  {
    value: 'round_robin',
    label: 'Strategy: round robin',
    description: 'Rotate ready providers per call.',
  },
  {
    value: 'weighted_round_robin',
    label: 'Strategy: weighted round robin',
    description: 'Rotate by provider weight.',
  },
  {
    value: 'least_used',
    label: 'Strategy: least used',
    description: 'Prefer the least-called ready provider.',
  },
  {
    value: 'rate_limit_aware',
    label: 'Strategy: rate-limit aware',
    description: 'Prefer providers not in cooldown.',
  },
];

/** Minimal research slice readable via harness.getConfig() — no agent-core import. */
export interface SearchConfigSlice {
  readonly research?: {
    readonly localSearch?: { readonly enabled?: boolean; readonly searxngUrl?: string };
    readonly search?: {
      readonly freeFallback?: boolean;
      readonly strategy?: SearchRoutingStrategySetting;
      readonly browserEscalate?: boolean;
      readonly preferXai?: boolean;
    };
  };
}

export type LocalResearchCacheStatus = 'on-disk' | 'off' | 'unknown';

export const LOCAL_RESEARCH_CACHE_CH0_TIP =
  'Ch0 local research cache sits in front of paid/free channels when configured.';

/** W13b: explicit Settings path for forcing $0 free fallback (default on). */
export const SEARCH_FREE_FALLBACK_FORCE_TIP =
  'Force free fallback: Settings → Search → Free fallback ON/OFF · research.search.freeFallback (default on).';

/** W13 soft: Ch2 meta/self-host — SearXNG env or research.localSearch.searxngUrl. */
export const SEARXNG_URL_ENV = 'SUPERLIORA_SEARXNG_URL';

export const SEARCH_META_CH2_TIP =
  `Ch2 Meta: Settings → Search → Set SearXNG URL, or ${SEARXNG_URL_ENV} / research.localSearch.searxngUrl (JSON format).`;

export const SEARCH_META_CH2_READY_TIP =
  'Ch2 Meta ready — SearXNG URL configured (soft; health probe on first search).';

export const SEARCH_FREE_ONLY_KPI_TIP =
  'Free-only KPI: soft-degrade rate vs hard-fail 0 — live after WebSearch/DeepResearch degrades in session.';

/** W13 runtime never-empty counters — live after WebSearch / DeepResearch degrade in session. */
export const SEARCH_NEVER_EMPTY_TELEMETRY_TIP =
  'Never-empty telemetry: hard-fail 0 target · soft-degrade counts session WebSearch/DeepResearch degrades.';

/** W13 Ch0 LocalResearchCache hit — live when usage.localResearchCache is wired. */
export const LOCAL_RESEARCH_CACHE_HIT_TIP =
  'LocalResearchCache hit: session lookup hit% (after WebSearch / DeepResearch in session)';

/** PreferXaiGrokWebSearchProvider — Grok Build web search before ResearchSearchEngine cascade. */
export const SEARCH_PREFER_XAI_TIP =
  'PreferXai: XAI_API_KEY or /login xAI → Grok Build web search, then ResearchSearchEngine cascade.';

export const SEARCH_XAI_ENV_LINE =
  'XAI_API_KEY (PreferXai Grok Build → ResearchSearchEngine cascade)';

/** Derive LocalResearchCache on/off from SDK config (disk path is runtime homeDir). */
export function resolveLocalResearchCacheStatus(
  config: SearchConfigSlice | null | undefined,
): LocalResearchCacheStatus {
  if (config === null || config === undefined) return 'unknown';
  if (config.research?.localSearch?.enabled === false) return 'off';
  return 'on-disk';
}

/** Advanced override env for disabling $0 free fallback (product default: forced on). */
export const ALLOW_DISABLE_FREE_FALLBACK_ENV = 'SUPERLIORA_ALLOW_DISABLE_FREE_FALLBACK';

/** Default-on: config false is ignored unless {@link ALLOW_DISABLE_FREE_FALLBACK_ENV}=1. */
export function resolveSearchFreeFallback(
  config: SearchConfigSlice | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (config?.research?.search?.freeFallback === false) {
    if (env[ALLOW_DISABLE_FREE_FALLBACK_ENV] === '1') return false;
    return true;
  }
  return true;
}

/** Patch shape for harness.setConfig — research.search.freeFallback. */
export function buildSearchFreeFallbackConfigPatch(enabled: boolean): {
  readonly research: { readonly search: { readonly freeFallback: boolean } };
} {
  return {
    research: {
      search: {
        freeFallback: enabled,
      },
    },
  };
}

/** Patch shape for harness.setConfig — research.search.strategy. */
export function buildSearchStrategyConfigPatch(strategy: SearchRoutingStrategySetting): {
  readonly research: { readonly search: { readonly strategy: SearchRoutingStrategySetting } };
} {
  return {
    research: {
      search: {
        strategy,
      },
    },
  };
}

/** Patch shape for harness.setConfig — research.search.browserEscalate (Ch4/Ch5 default). */
export function buildSearchBrowserEscalateConfigPatch(enabled: boolean): {
  readonly research: { readonly search: { readonly browserEscalate: boolean } };
} {
  return {
    research: {
      search: {
        browserEscalate: enabled,
      },
    },
  };
}

export function resolveSearchStrategy(
  config: SearchConfigSlice | null | undefined,
): SearchRoutingStrategySetting {
  return config?.research?.search?.strategy ?? 'auto';
}

/** Default-on: omit / undefined means Ch4/Ch5 escalate allowed for WebSearch. */
export function resolveSearchBrowserEscalate(
  config: SearchConfigSlice | null | undefined,
): boolean {
  return config?.research?.search?.browserEscalate !== false;
}

export function formatSearchStrategyLine(strategy: SearchRoutingStrategySetting): string {
  return `Strategy: ${strategy} (research.search.strategy)`;
}

export function formatSearchBrowserEscalateLine(enabled: boolean): string {
  return `Browser escalate (Ch4/Ch5): ${enabled ? 'on' : 'off'} (research.search.browserEscalate)`;
}

/** Patch shape for harness.setConfig — research.search.preferXai. */
export function buildSearchPreferXaiConfigPatch(enabled: boolean): {
  readonly research: { readonly search: { readonly preferXai: boolean } };
} {
  return {
    research: {
      search: {
        preferXai: enabled,
      },
    },
  };
}

/** Default-on: PreferXai wrap when an xAI client is available. */
export function resolveSearchPreferXai(
  config: SearchConfigSlice | null | undefined,
): boolean {
  return config?.research?.search?.preferXai !== false;
}

export function formatSearchPreferXaiLine(enabled: boolean): string {
  return `PreferXai (Grok Build first): ${enabled ? 'on' : 'off'} (research.search.preferXai)`;
}

/** Patch shape for harness.setConfig — research.localSearch.searxngUrl (Ch2). */
export function buildSearchSearxngUrlConfigPatch(url: string): {
  readonly research: { readonly localSearch: { readonly searxngUrl: string } };
} {
  return {
    research: {
      localSearch: {
        searxngUrl: url,
      },
    },
  };
}

/** Clear config searxngUrl (env SUPERLIORA_SEARXNG_URL may still apply). */
export function buildSearchClearSearxngUrlConfigPatch(): {
  readonly research: { readonly localSearch: { readonly searxngUrl: string } };
} {
  return {
    research: {
      localSearch: {
        searxngUrl: '',
      },
    },
  };
}

export function isValidSearxngUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function formatLocalResearchCacheLine(status: LocalResearchCacheStatus): string {
  switch (status) {
    case 'on-disk':
      return 'Local cache: on (disk)';
    case 'off':
      return 'Local cache: off';
    default:
      return 'Local cache: unknown';
  }
}

/** Ch5 Chrome extension bridge — mirrors agent-core research-bridge-status (no agent-core import). */
export const CHROME_RESEARCH_BRIDGE_ENV = 'SUPERLIORA_CHROME_RESEARCH_BRIDGE';
export const CHROME_EXT_BRIDGE_ENV = 'SUPERLIORA_CHROME_EXT_BRIDGE';
export const CHROME_EXT_URL_ENV = 'SUPERLIORA_CHROME_EXT_URL';
export const DEFAULT_CHROME_EXT_BRIDGE_URL = 'http://127.0.0.1:32123/search';
export const NATIVE_HOST_ID = 'com.superliora.research_bridge';
export const NATIVE_HOST_SCRIPT_REL = 'scripts/research-bridge-native-host.mjs';
export const AGENT_CORE_ROOT_ENV = 'SUPERLIORA_AGENT_CORE_ROOT';
export const NATIVE_HOST_SMOKE_TIMEOUT_MS = 1_500;
export const NATIVE_HOST_SMOKE_CACHE_TTL_MS = 30_000;
export const NATIVE_HOST_SMOKE_SKIP_ENV = 'SUPERLIORA_RESEARCH_BRIDGE_SKIP_SMOKE';

export const CHROME_EXT_BRIDGE_CH5_TIP =
  `Ch5 bridge: ${CHROME_RESEARCH_BRIDGE_ENV}=1 (legacy ${CHROME_EXT_BRIDGE_ENV}=1) · optional ${CHROME_EXT_URL_ENV} ` +
  `(default ${DEFAULT_CHROME_EXT_BRIDGE_URL}) · runtime auto-spawns native-host --serve when loopback probe fails · ` +
  `native-messaging host ${NATIVE_HOST_ID} + SuperLiora extension.`;

export type ResearchBridgeHandshake =
  | 'off'
  | 'env-gated'
  | 'manifest-present'
  | 'host-script-ready'
  | 'smoke-verified';

export interface NativeHostSmokeProbe {
  readonly ok: boolean;
  readonly version?: string | undefined;
  readonly error?: string | undefined;
  readonly probedAt: number;
}

export interface NativeHostSmokeDeps {
  readonly spawnSync?: typeof spawnSync | undefined;
  readonly now?: (() => number) | undefined;
}

export interface DetectSearchLateChannelOptions {
  readonly agentCoreRoot?: string | undefined;
  readonly probeSmoke?: boolean | undefined;
  readonly smokeDeps?: NativeHostSmokeDeps | undefined;
  readonly startDir?: string | undefined;
}

export interface SearchLateChannelEnv {
  /** Ch5: SUPERLIORA_CHROME_RESEARCH_BRIDGE=1 or legacy SUPERLIORA_CHROME_EXT_BRIDGE=1 */
  readonly chromeExtBridge: boolean;
  readonly chromeExtUrl: string | null;
  readonly nativeHandshake: ResearchBridgeHandshake;
  readonly nativeSmokeVersion?: string | null;
  /** Ch2: SUPERLIORA_SEARXNG_URL or research.localSearch.searxngUrl */
  readonly searxngUrl: string | null;
  readonly ch2Ready: boolean;
}

function resolveSearxngUrlFromEnv(env: NodeJS.ProcessEnv): string | null {
  const url = env[SEARXNG_URL_ENV]?.trim();
  return url !== undefined && url.length > 0 ? url : null;
}

function formatCh2MetaLadderLine(late: SearchLateChannelEnv): string {
  if (late.ch2Ready && late.searxngUrl != null) {
    return `Ch2 Meta: SearXNG ready (${late.searxngUrl}) · ${SEARXNG_URL_ENV} or research.localSearch.searxngUrl`;
  }
  return `Ch2 Meta: SearXNG/YaCy self-host (off) · set ${SEARXNG_URL_ENV} or research.localSearch.searxngUrl`;
}

function isChromeResearchBridgeEnabled(env: NodeJS.ProcessEnv): boolean {
  return env[CHROME_RESEARCH_BRIDGE_ENV] === '1' || env[CHROME_EXT_BRIDGE_ENV] === '1';
}

function resolveNativeHostManifestPath(env: NodeJS.ProcessEnv): string {
  const override = env['SUPERLIORA_RESEARCH_BRIDGE_MANIFEST']?.trim();
  if (override !== undefined && override.length > 0) return override;
  const home = env['HOME'] ?? env['USERPROFILE'] ?? '';
  if (process.platform === 'darwin') {
    return `${home}/Library/Application Support/Google/Chrome/NativeMessagingHosts/${NATIVE_HOST_ID}.json`;
  }
  if (process.platform === 'win32') {
    const local = env['LOCALAPPDATA'] ?? home;
    return `${local}/Google/Chrome/User Data/NativeMessagingHosts/${NATIVE_HOST_ID}.json`;
  }
  return `${home}/.config/google-chrome/NativeMessagingHosts/${NATIVE_HOST_ID}.json`;
}

export function resolveAgentCoreRootForBridge(
  env: NodeJS.ProcessEnv = process.env,
  startDir: string = process.cwd(),
): string | undefined {
  const override = env[AGENT_CORE_ROOT_ENV]?.trim();
  if (override !== undefined && override.length > 0) {
    if (existsSync(join(override, NATIVE_HOST_SCRIPT_REL))) return override;
  }
  let dir = startDir;
  for (let depth = 0; depth < 12; depth += 1) {
    const candidate = join(dir, 'packages/agent-core');
    if (existsSync(join(candidate, NATIVE_HOST_SCRIPT_REL))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function resolveNativeHostScriptPath(agentCoreRoot: string): string {
  return join(agentCoreRoot, NATIVE_HOST_SCRIPT_REL);
}

interface SmokeCacheEntry {
  readonly key: string;
  readonly probe: NativeHostSmokeProbe;
}

let nativeHostSmokeCache: SmokeCacheEntry | null = null;

/** Clears module smoke cache — test hook only. */
export function clearResearchBridgeSmokeCache(): void {
  nativeHostSmokeCache = null;
}

function smokeCacheKey(scriptPath: string, env: NodeJS.ProcessEnv): string {
  const bridgeUrl = env[CHROME_EXT_URL_ENV]?.trim() ?? '';
  const skip = env[NATIVE_HOST_SMOKE_SKIP_ENV] === '1' ? '1' : '0';
  return `${scriptPath}:${bridgeUrl}:${skip}`;
}

function readCachedSmokeProbe(
  scriptPath: string,
  env: NodeJS.ProcessEnv,
  now: number,
): NativeHostSmokeProbe | undefined {
  const cached = nativeHostSmokeCache;
  if (cached === null) return undefined;
  if (cached.key !== smokeCacheKey(scriptPath, env)) return undefined;
  if (now - cached.probe.probedAt > NATIVE_HOST_SMOKE_CACHE_TTL_MS) return undefined;
  return cached.probe;
}

function storeSmokeProbeCache(
  scriptPath: string,
  env: NodeJS.ProcessEnv,
  probe: NativeHostSmokeProbe,
): void {
  nativeHostSmokeCache = { key: smokeCacheKey(scriptPath, env), probe };
}

function parseSmokeStdout(stdout: string): string | undefined {
  const match = stdout.match(/research-bridge-native-host smoke ok \(([^)]+)\)/);
  return match?.[1];
}

/** Runs native-host `--smoke` once (sync, short timeout). Injectable for tests. */
export function probeNativeHostSmoke(
  scriptPath: string,
  env: NodeJS.ProcessEnv = process.env,
  deps: NativeHostSmokeDeps = {},
): NativeHostSmokeProbe {
  const now = deps.now ?? Date.now;
  const probedAt = now();
  const cached = readCachedSmokeProbe(scriptPath, env, probedAt);
  if (cached !== undefined) return cached;

  const spawn = deps.spawnSync ?? spawnSync;
  const result: SpawnSyncReturns<string> = spawn(process.execPath, [scriptPath, '--smoke'], {
    env,
    encoding: 'utf8',
    timeout: NATIVE_HOST_SMOKE_TIMEOUT_MS,
  });

  let probe: NativeHostSmokeProbe;
  if (result.error !== undefined) {
    probe = {
      ok: false,
      error: result.error.message,
      probedAt,
    };
  } else if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status ?? '?'}`;
    probe = {
      ok: false,
      error: detail,
      probedAt,
    };
  } else {
    const stdout = result.stdout ?? '';
    const version = parseSmokeStdout(stdout);
    if (!stdout.includes('research-bridge-native-host smoke ok')) {
      probe = {
        ok: false,
        error: stdout.trim() || 'unexpected smoke output',
        probedAt,
      };
    } else {
      probe = {
        ok: true,
        version,
        probedAt,
      };
    }
  }

  storeSmokeProbeCache(scriptPath, env, probe);
  return probe;
}

function shouldProbeNativeHostSmoke(
  env: NodeJS.ProcessEnv,
  probeSmoke: boolean | undefined,
): boolean {
  if (probeSmoke === false) return false;
  if (env[NATIVE_HOST_SMOKE_SKIP_ENV] === '1') return false;
  return isChromeResearchBridgeEnabled(env);
}

function detectNativeHandshake(
  env: NodeJS.ProcessEnv,
  options: DetectSearchLateChannelOptions = {},
): { readonly handshake: ResearchBridgeHandshake; readonly smokeVersion?: string } {
  if (!isChromeResearchBridgeEnabled(env)) return { handshake: 'off' };
  const manifestPath = resolveNativeHostManifestPath(env);
  if (!existsSync(manifestPath)) return { handshake: 'env-gated' };

  const agentCoreRoot =
    options.agentCoreRoot ?? resolveAgentCoreRootForBridge(env, options.startDir);
  if (agentCoreRoot === undefined) return { handshake: 'manifest-present' };

  const hostScriptPath = resolveNativeHostScriptPath(agentCoreRoot);
  if (!existsSync(hostScriptPath)) return { handshake: 'manifest-present' };

  if (shouldProbeNativeHostSmoke(env, options.probeSmoke)) {
    const smoke = probeNativeHostSmoke(hostScriptPath, env, options.smokeDeps ?? {});
    if (smoke.ok) {
      return { handshake: 'smoke-verified', smokeVersion: smoke.version };
    }
    return { handshake: 'host-script-ready' };
  }

  return { handshake: 'host-script-ready' };
}

export function formatResearchBridgeHandshakeLine(
  handshake: ResearchBridgeHandshake,
  smokeVersion?: string | undefined,
): string {
  switch (handshake) {
    case 'smoke-verified':
      return smokeVersion !== undefined
        ? `Native host: smoke verified (${smokeVersion})`
        : 'Native host: smoke verified';
    case 'manifest-present':
      return 'Native host: manifest present (script unverified)';
    case 'env-gated':
      return 'Native host: env-gated (manifest not installed)';
    case 'host-script-ready':
      return 'Native host: ready (manifest + stub script)';
    default:
      return 'Native host: off';
  }
}
const ENV_MAP: ReadonlyArray<{ readonly kind: string; readonly envs: readonly string[] }> = [
  { kind: 'xai_grok', envs: ['XAI_API_KEY'] },
  { kind: 'brave', envs: ['BRAVE_API_KEY', 'BRAVE_SEARCH_API_KEY'] },
  { kind: 'tavily', envs: ['TAVILY_API_KEY'] },
  { kind: 'exa', envs: ['EXA_API_KEY'] },
  { kind: 'serper', envs: ['SERPER_API_KEY', 'SERPER_DEV_API_KEY'] },
  { kind: 'google_cse', envs: ['GOOGLE_CSE_API_KEY', 'GOOGLE_API_KEY'] },
  { kind: 'bing', envs: ['BING_SEARCH_API_KEY', 'AZURE_BING_SEARCH_KEY'] },
];

export function detectSearchProviderEnvKeys(env: NodeJS.ProcessEnv = process.env): SearchEnvStatus {
  const configured: string[] = [];
  for (const entry of ENV_MAP) {
    for (const name of entry.envs) {
      const value = env[name]?.trim();
      if (value !== undefined && value.length > 0) {
        configured.push(entry.kind);
        break;
      }
    }
  }
  const hints: string[] = [
    SEARCH_FREE_FALLBACK_FORCE_TIP,
    'Google CSE also needs GOOGLE_CSE_ID (or GOOGLE_CSE_CX).',
    SEARCH_META_CH2_TIP,
    CHROME_EXT_BRIDGE_CH5_TIP,
  ];
  if (configured.includes('google_cse')) {
    const cx =
      (env['GOOGLE_CSE_ID']?.trim() ??
      env['GOOGLE_CSE_CX']?.trim()) ??
      env['GOOGLE_SEARCH_ENGINE_ID']?.trim();
    if (cx === undefined || cx.length === 0) {
      hints.unshift('google_cse key found but CSE id missing — set GOOGLE_CSE_ID.');
    }
  }
  if (configured.includes('xai_grok')) {
    hints.unshift(SEARCH_PREFER_XAI_TIP);
  }
  if (resolveSearxngUrlFromEnv(env) != null) {
    hints.unshift(SEARCH_META_CH2_READY_TIP);
  }
  return { configured, freeFallback: true, hints };
}

function resolveCh2SearxngUrl(
  env: NodeJS.ProcessEnv,
  config?: SearchConfigSlice | null,
): string | null {
  const configUrl = config?.research?.localSearch?.searxngUrl?.trim();
  if (configUrl !== undefined && configUrl.length > 0) return configUrl;
  return resolveSearxngUrlFromEnv(env);
}

export function detectSearchLateChannelEnv(
  env: NodeJS.ProcessEnv = process.env,
  config?: SearchConfigSlice | null,
  options?: DetectSearchLateChannelOptions,
): SearchLateChannelEnv {
  const chromeUrl = env[CHROME_EXT_URL_ENV]?.trim();
  const searxngUrl = resolveCh2SearxngUrl(env, config);
  const native = detectNativeHandshake(env, options);
  return {
    chromeExtBridge: isChromeResearchBridgeEnabled(env),
    chromeExtUrl: chromeUrl !== undefined && chromeUrl.length > 0 ? chromeUrl : null,
    nativeHandshake: native.handshake,
    nativeSmokeVersion: native.smokeVersion ?? null,
    searxngUrl,
    ch2Ready: searxngUrl != null,
  };
}

/** Compact suffix for Ops Runtime Health search line (env-gated channels only). */
export function formatSearchLateChannelOpsSuffix(late: SearchLateChannelEnv): string {
  const parts: string[] = [];
  if (late.ch2Ready) {
    parts.push('Ch2 SearXNG ready');
  }
  if (late.chromeExtBridge) {
    if (late.nativeHandshake === 'smoke-verified') {
      const version =
        late.nativeSmokeVersion != null && late.nativeSmokeVersion.length > 0
          ? ` (${late.nativeSmokeVersion})`
          : '';
      parts.push(`Ch5 smoke verified${version}`);
    } else {
      parts.push('Ch5 chrome-ext ON');
    }
  }
  return parts.length > 0 ? ` · ${parts.join(' · ')}` : '';
}

export function buildSearchEscalateLadderLines(
  status: SearchEnvStatus,
  late: SearchLateChannelEnv,
): string[] {
  const paid =
    status.configured.length > 0
      ? `Ch1 Paid/API: ${status.configured.join(', ')} + free fallback`
      : 'Ch1 Paid/API: (no keys) · free fallback (DDG/local)';
  const meta = formatCh2MetaLadderLine(late);
  const fetch =
    'Ch3 Fetch: DDG IA JSON → DDG HTML/Lite + LocalResearchCache · Ch6 free fallback when channels thin';
  const browser = 'Ch4 Browser: gui-use when session wired · liora browser-use doctor';
  const chrome = late.chromeExtBridge
    ? `Ch5 Chrome ext: ON (${CHROME_RESEARCH_BRIDGE_ENV}=1${late.chromeExtUrl != null ? ` · ${late.chromeExtUrl}` : ` · ${DEFAULT_CHROME_EXT_BRIDGE_URL}`}) · ${formatResearchBridgeHandshakeLine(late.nativeHandshake, late.nativeSmokeVersion ?? undefined)}`
    : `Ch5 Chrome ext: off (set ${CHROME_RESEARCH_BRIDGE_ENV}=1 · ${DEFAULT_CHROME_EXT_BRIDGE_URL})`;
  return ['── Escalate ladder ─────────────────────────', paid, meta, fetch, browser, chrome];
}

export function buildSearchSettingsStatusLines(input: {
  readonly status: SearchEnvStatus;
  readonly late: SearchLateChannelEnv;
  readonly cacheStatus: LocalResearchCacheStatus;
  readonly freeFallback: boolean;
  readonly strategy?: SearchRoutingStrategySetting;
  readonly browserEscalate?: boolean;
  readonly preferXai?: boolean;
  readonly neverEmptyTelemetryLine?: string | null;
  readonly localResearchCacheHitLine?: string | null;
  readonly freeOnlyKpiLine?: string | null;
  /** SSOT: AppState.searchCascade — channelsTried from WebSearch/DeepResearch degrade. */
  readonly searchCascade?: AppState['searchCascade'];
  readonly nowMs?: number;
}): string[] {
  const {
    status,
    late,
    cacheStatus,
    freeFallback,
    strategy = 'auto',
    browserEscalate = true,
    preferXai = true,
    neverEmptyTelemetryLine,
    localResearchCacheHitLine,
    freeOnlyKpiLine,
    searchCascade,
    nowMs,
  } = input;
  const cascadeLiveLine =
    searchCascade !== undefined
      ? formatSearchCascadeSessionGlance(searchCascade, nowMs)
      : null;
  return [
    ...buildSearchEscalateLadderLines(status, late),
    '',
    ...buildSearchCascadeSessionLiveLines(searchCascade, nowMs),
    '',
    '── Detected now ────────────────────────────',
    formatLocalResearchCacheLine(cacheStatus),
    ...(localResearchCacheHitLine != null && localResearchCacheHitLine.length > 0
      ? [`LocalResearchCache: ${localResearchCacheHitLine}`]
      : []),
    ...(neverEmptyTelemetryLine != null && neverEmptyTelemetryLine.length > 0
      ? [`Never-empty: ${neverEmptyTelemetryLine}`]
      : []),
    ...(freeOnlyKpiLine != null && freeOnlyKpiLine.length > 0
      ? [`Free-only KPI: ${freeOnlyKpiLine}`]
      : []),
    ...(cacheStatus === 'unknown' ? [`· ${LOCAL_RESEARCH_CACHE_CH0_TIP}`] : []),
    ...(localResearchCacheHitLine == null ? [`· ${LOCAL_RESEARCH_CACHE_HIT_TIP}`] : []),
    status.configured.length > 0
      ? `Ready: ${status.configured.join(', ')}`
      : 'Ready: (no paid API keys in env)',
    ...(late.ch2Ready && late.searxngUrl != null
      ? [`Ch2 Meta: SearXNG ready (${late.searxngUrl})`]
      : []),
    ...(late.chromeExtBridge
      ? [
          late.nativeHandshake === 'smoke-verified'
            ? `Ch5 bridge: smoke verified · ${formatResearchBridgeHandshakeLine(late.nativeHandshake, late.nativeSmokeVersion ?? undefined)}`
            : formatResearchBridgeHandshakeLine(late.nativeHandshake, late.nativeSmokeVersion ?? undefined),
        ]
      : []),
    formatSearchStrategyLine(strategy),
    formatSearchBrowserEscalateLine(browserEscalate),
    formatSearchPreferXaiLine(preferXai),
    `Free fallback: ${freeFallback ? 'on' : 'off'} (research.search.freeFallback)`,
    `· ${SEARCH_FREE_FALLBACK_FORCE_TIP}`,
    '',
    '── Env keys (Ch1) ──────────────────────────',
    `  ${SEARCH_XAI_ENV_LINE}`,
    '  BRAVE_API_KEY · TAVILY_API_KEY · EXA_API_KEY',
    '  SERPER_API_KEY · GOOGLE_API_KEY + GOOGLE_CSE_ID',
    '  BING_SEARCH_API_KEY',
    '',
    `── Ch2 meta (SearXNG) ──────────────────────`,
    `  ${SEARXNG_URL_ENV} (or research.localSearch.searxngUrl)`,
    ...(late.ch2Ready ? [`  Ready: ${late.searxngUrl}`] : [`  · ${SEARCH_META_CH2_TIP}`]),
    '',
    ...status.hints.map((h) => `· ${h}`),
    '',
    '── Late channels (Ch4–5) ───────────────────',
    '· Ch4: gui-use browser automation when session wired',
    `· ${CHROME_EXT_BRIDGE_CH5_TIP}`,
    '',
    'Never-empty: WebSearch/DeepResearch soft-fail degraded=true + next-step hints (no hard empty throw).',
    ...(neverEmptyTelemetryLine == null ? [`· ${SEARCH_NEVER_EMPTY_TELEMETRY_TIP}`] : []),
    'Escalate: Ch1 paid → Ch2 meta → Ch3 fetch/free → Ch4 browser → Ch5 chrome-ext bridge.',
    ...(freeOnlyKpiLine == null ? [`· ${SEARCH_FREE_ONLY_KPI_TIP}`] : []),
    ...(cascadeLiveLine == null
      ? [
          'Cascade: both tools emit channelsTried on degrade → footer research↻ line (~30s).',
        ]
      : []),
  ];
}
