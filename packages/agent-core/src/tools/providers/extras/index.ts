/**
 * Provider extras registry — subscription/plan capabilities beyond chat.
 *
 * One declaration per service that ships extras (web search, image/video
 * generation, dedicated MCP servers) alongside its models. Detection scans
 * env keys and `config.providers` once; runtime wiring (search slots, media
 * env, MCP auto-injection) consumes the result so every surface agrees on
 * what is available.
 */

import type {
  ProviderExtrasCapability,
  ProviderExtrasDetectedEntry,
  ProviderExtrasSearchSlotStatus,
  ProviderExtrasStatus,
} from '@superliora/protocol';

import type { LioraConfig, ResearchSearchProviderConfig } from '#/config/schema';

import type { ResearchSearchStatus } from '../research-search-types';

export type ProviderExtrasId = 'zai' | 'qwen-token-plan' | 'xai-grok' | 'openai-codex';

export interface ProviderExtrasDeclaration {
  readonly id: ProviderExtrasId;
  readonly label: string;
  /** `config.providers` ids that identify this service. */
  readonly providerIds: readonly string[];
  /** Env vars that may carry a dedicated API key (first hit wins). */
  readonly envKeys: readonly string[];
  readonly extras: {
    readonly webSearch: boolean;
    readonly imageGen: boolean;
    readonly videoGen: boolean;
    readonly mcpServers: boolean;
  };
}

export interface DetectedProviderExtras {
  readonly declaration: ProviderExtrasDeclaration;
  /** Resolved API key (env beats config provider entry). */
  readonly apiKey?: string;
  /** Env var name the key came from, when env-sourced. */
  readonly apiKeyEnv?: string;
  /** Matched `config.providers` id, when configured. */
  readonly providerId?: string;
  /** The matched provider entry carries an OAuth reference. */
  readonly hasOAuth: boolean;
  /** Configured provider base URL, when present. */
  readonly baseUrl?: string;
}

export const PROVIDER_EXTRAS: readonly ProviderExtrasDeclaration[] = [
  {
    id: 'zai',
    label: 'Z.AI (GLM Coding Plan)',
    providerIds: ['zai-coding-plan', 'zai'],
    envKeys: ['Z_AI_API_KEY', 'ZAI_API_KEY'],
    extras: { webSearch: true, imageGen: false, videoGen: false, mcpServers: true },
  },
  {
    id: 'qwen-token-plan',
    label: 'Alibaba Token Plan',
    providerIds: ['qwen-token-plan', 'alibaba-token-plan', 'alibaba-token-plan-cn'],
    envKeys: ['QWEN_TOKEN_PLAN_API_KEY', 'ALIBABA_TOKEN_PLAN_API_KEY'],
    extras: { webSearch: false, imageGen: true, videoGen: true, mcpServers: false },
  },
  {
    id: 'xai-grok',
    label: 'xAI Grok Build',
    providerIds: ['xai-grok'],
    envKeys: ['XAI_API_KEY'],
    extras: { webSearch: true, imageGen: true, videoGen: true, mcpServers: false },
  },
  {
    id: 'openai-codex',
    label: 'OpenAI Codex (ChatGPT)',
    providerIds: ['openai-codex'],
    envKeys: [],
    extras: { webSearch: true, imageGen: true, videoGen: false, mcpServers: false },
  },
];

export function getProviderExtrasDeclaration(
  id: ProviderExtrasId,
): ProviderExtrasDeclaration | undefined {
  return PROVIDER_EXTRAS.find((d) => d.id === id);
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

/** True when the user has NOT opted this extras service out in config. */
export function isProviderExtrasEnabled(
  config: Pick<LioraConfig, 'extras'> | undefined,
  id: ProviderExtrasId,
): boolean {
  return !(config?.extras?.disabledProviders ?? []).includes(id);
}

/**
 * Detect which declared provider extras are usable right now. A declaration
 * is included when a dedicated env key is set or a matching provider entry
 * exists in the config (API key and/or OAuth ref). Services listed in
 * `config.extras.disabledProviders` are excluded unless
 * `options.includeDisabled` is set (status projection).
 */
export function detectProviderExtras(
  config: Pick<LioraConfig, 'providers' | 'extras'> | undefined,
  env: NodeJS.ProcessEnv = process.env,
  options?: { readonly includeDisabled?: boolean },
): DetectedProviderExtras[] {
  const out: DetectedProviderExtras[] = [];
  for (const declaration of PROVIDER_EXTRAS) {
    if (options?.includeDisabled !== true && !isProviderExtrasEnabled(config, declaration.id)) {
      continue;
    }
    let apiKey: string | undefined;
    let apiKeyEnv: string | undefined;
    for (const envKey of declaration.envKeys) {
      const value = nonEmpty(env[envKey]);
      if (value !== undefined) {
        apiKey = value;
        apiKeyEnv = envKey;
        break;
      }
    }

    let providerId: string | undefined;
    let hasOAuth = false;
    let baseUrl: string | undefined;
    for (const id of declaration.providerIds) {
      const provider = config?.providers[id];
      if (provider === undefined) continue;
      providerId ??= id;
      baseUrl ??= nonEmpty(provider.baseUrl);
      if (provider.oauth !== undefined || (provider.oauths?.length ?? 0) > 0) {
        hasOAuth = true;
      }
      if (apiKey === undefined) {
        apiKey = nonEmpty(provider.apiKey);
      }
    }

    if (apiKey === undefined && !hasOAuth && providerId === undefined) continue;
    out.push({
      declaration,
      ...(apiKey !== undefined ? { apiKey } : {}),
      ...(apiKeyEnv !== undefined ? { apiKeyEnv } : {}),
      ...(providerId !== undefined ? { providerId } : {}),
      hasOAuth,
      ...(baseUrl !== undefined ? { baseUrl } : {}),
    });
  }
  return out;
}

/**
 * Config-sourced Z.AI search slot. Env-sourced keys are picked up by the
 * engine's own env detection; this feeds the `config.providers` key path so
 * a catalog-configured Z.AI plan joins the search cascade too. Returns
 * undefined when the service is opted out or the key came from env.
 */
export function resolveZaiSearchProviderConfig(
  config: Pick<LioraConfig, 'providers' | 'extras'> | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ResearchSearchProviderConfig | undefined {
  if (!isProviderExtrasEnabled(config, 'zai')) return undefined;
  const detected = detectProviderExtras(config, env).find((d) => d.declaration.id === 'zai');
  if (detected?.apiKey === undefined || detected.apiKeyEnv !== undefined) return undefined;
  return {
    kind: 'zai',
    label: 'zai',
    apiKey: detected.apiKey,
    ...(detected.baseUrl !== undefined ? { baseUrl: detected.baseUrl } : {}),
  };
}

// ---------------------------------------------------------------------------
// /status projection
// ---------------------------------------------------------------------------

/** Minimal engine surface the projector needs (ResearchSearchEngine). */
export interface ProviderExtrasStatusEngine {
  status(): Pick<ResearchSearchStatus, 'providers'>;
}

function capabilitiesOf(declaration: ProviderExtrasDeclaration): ProviderExtrasCapability[] {
  const out: ProviderExtrasCapability[] = [];
  if (declaration.extras.webSearch) out.push('web_search');
  if (declaration.extras.imageGen) out.push('image_gen');
  if (declaration.extras.videoGen) out.push('video_gen');
  if (declaration.extras.mcpServers) out.push('mcp_servers');
  return out;
}

function detectedSource(detected: DetectedProviderExtras): ProviderExtrasDetectedEntry['source'] {
  if (detected.hasOAuth) return 'oauth';
  if (detected.apiKeyEnv !== undefined) return 'env';
  return 'config';
}

/**
 * Project detected extras + live search/media routing into the wire status
 * consumed by /status. Disabled services stay listed (flagged) so the user
 * can see what was auto-detected and turned off.
 */
export function buildProviderExtrasStatus(input: {
  readonly config: Pick<LioraConfig, 'providers' | 'extras'> | undefined;
  readonly env?: NodeJS.ProcessEnv;
  readonly engine?: ProviderExtrasStatusEngine | undefined;
  readonly autoMcpServers?: readonly string[] | undefined;
}): ProviderExtrasStatus {
  const env = input.env ?? process.env;
  const detected = detectProviderExtras(input.config, env, { includeDisabled: true });
  const active = new Map(detected.filter((d) => isProviderExtrasEnabled(input.config, d.declaration.id))
    .map((d) => [d.declaration.id, d]));

  const providers: ProviderExtrasDetectedEntry[] = detected.map((d) => ({
    id: d.declaration.id,
    label: d.declaration.label,
    source: detectedSource(d),
    capabilities: capabilitiesOf(d.declaration),
    disabled: !isProviderExtrasEnabled(input.config, d.declaration.id),
  }));

  const image: string[] = [];
  if (active.has('xai-grok')) image.push('xai-grok');
  if (active.has('qwen-token-plan')) image.push('qwen');
  if (active.has('openai-codex')) image.push('codex');
  if (nonEmpty(env['OPENAI_API_KEY']) !== undefined) image.push('openai');
  if (nonEmpty(env['GOOGLE_API_KEY'] ?? env['GEMINI_API_KEY']) !== undefined) image.push('google');

  const video: string[] = [];
  if (active.has('xai-grok')) video.push('xai-grok');
  if (active.has('qwen-token-plan')) video.push('qwen');
  if (nonEmpty(env['GOOGLE_API_KEY'] ?? env['GEMINI_API_KEY']) !== undefined) video.push('google');

  const searchCascade: ProviderExtrasSearchSlotStatus[] =
    input.engine?.status().providers.map((slot) => ({
      id: slot.id,
      kind: slot.kind,
      label: slot.label,
      ready: slot.ready,
      source: slot.source,
      ...(slot.cooldownUntil !== undefined ? { cooldownUntil: slot.cooldownUntil } : {}),
    })) ?? [];

  return {
    providers,
    searchCascade,
    media: { image, video },
    autoMcpServers: input.autoMcpServers ?? [],
  };
}
