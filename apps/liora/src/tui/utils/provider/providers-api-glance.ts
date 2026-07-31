/**
 * Providers & API settings glance — read-only env detection + tips (SSOT §9.2).
 * No key storage UI; credentials live in env, config.toml, or OAuth pools.
 */

import type { ModelAlias, ProviderRouteStatus } from '@superliora/sdk';

import { SEARCH_PREFER_XAI_TIP } from '../../commands/config/search/search-status';
import { modelRouteDisplayName } from '../model/model-route-notice';
import { formatOpsRouteLine } from '../model/route-glance';
import { oauthAccountsResilienceTips } from '../never-halt/auth-glance';

/** W11 soft — OSS absorb waves; license checklist only (no runtime wiring here). */
export const OSS_ABSORB_LICENSE_TIP =
  'W11 OSS absorb: ApplyPatch · ast-grep · ToolSearchIndex · Zoekt — license review + THIRD_PARTY_NOTICES per absorb PR.';

/** Free research when paid search keys are absent (Never-Empty default). */
export const PROVIDERS_FREE_SEARCH_TIP =
  'Free search path: Settings → Search · free fallback ON · DDG/local when no Brave/Tavily/Exa keys.';

/** /login — OAuth, catalog, custom endpoint, account pool. */
export const PROVIDERS_LOGIN_TIP =
  '/login — connect OAuth, add catalog/custom provider, or import a custom endpoint. /login --add for fallback OAuth slots · Settings → Accounts to promote, label, or remove pool entries.';

export interface ProviderApiKeyEnvSpec {
  readonly label: string;
  readonly envs: readonly string[];
}

/** Common LLM provider API key env vars (presence only — never echo values). */
export const PROVIDER_API_KEY_ENVS: readonly ProviderApiKeyEnvSpec[] = [
  { label: 'Kimi / SuperLiora', envs: ['KIMI_API_KEY', 'MOONSHOT_API_KEY'] },
  { label: 'Anthropic', envs: ['ANTHROPIC_API_KEY'] },
  { label: 'OpenAI', envs: ['OPENAI_API_KEY'] },
  { label: 'Google / Gemini', envs: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'] },
  { label: 'xAI Grok', envs: ['XAI_API_KEY'] },
  { label: 'ClinePass', envs: ['CLINE_API_KEY'] },
];

/** Common provider API key env vars — presence only; never paste keys into the TUI. */
export const PROVIDERS_API_KEY_ENVS_TIP = [
  'Provider API keys via env (presence only — export before `liora` starts):',
  ...PROVIDER_API_KEY_ENVS.map((spec) => `${spec.label}: ${spec.envs.join(' · ')}`),
  'Optional: KIMI_REGISTRY_API_KEY (models.dev catalog) · KIMI_PROVIDER_API_KEY (CLI provider batch).',
  'config.toml [providers.*] — api_key or env:VAR references.',
].join(' ');

export interface ProvidersApiSessionGlance {
  readonly modelAlias?: string;
  readonly providerId?: string;
  readonly modelLabel?: string;
  readonly providerModel?: string;
  readonly sessionUnavailable?: boolean;
  readonly routeLine?: string | null;
  readonly catalogModels?: number;
  readonly catalogProviders?: number;
}

export interface ProvidersApiGlanceInput {
  readonly configuredLabels: readonly string[];
  readonly registryKeySet: boolean;
  readonly providerKeySet: boolean;
  /** When false/undefined, PreferXai web-search tip is omitted (no WebSearch in session). */
  readonly webSearchActive?: boolean;
  readonly session?: ProvidersApiSessionGlance;
}

export function resolveProvidersApiSessionGlance(input: {
  readonly statusModel?: string;
  readonly appStateModel?: string;
  readonly availableModels?: Readonly<Record<string, ModelAlias>>;
  readonly providerRouteStatus?: ProviderRouteStatus | null;
  readonly catalogModels?: number;
  readonly catalogProviders?: number;
  readonly sessionUnavailable?: boolean;
}): ProvidersApiSessionGlance {
  const alias = (input.statusModel ?? input.appStateModel ?? '').trim();
  const models = input.availableModels ?? {};
  const entry = alias.length > 0 ? models[alias] : undefined;

  return {
    modelAlias: alias.length > 0 ? alias : undefined,
    providerId: entry?.provider,
    modelLabel: alias.length > 0 ? modelRouteDisplayName(alias, models) : undefined,
    providerModel: entry?.model,
    routeLine: formatOpsRouteLine({
      providerRouteStatus: input.providerRouteStatus,
      availableModels: models,
    }),
    catalogModels: input.catalogModels,
    catalogProviders: input.catalogProviders,
    sessionUnavailable: input.sessionUnavailable,
  };
}

/** Live active model from session.getStatus().model + catalog. */
export function formatActiveModelLine(glance: ProvidersApiSessionGlance): string {
  if (glance.sessionUnavailable === true) {
    return 'Active model: (no active session — start one to inspect provider routing)';
  }
  if (glance.modelAlias === undefined || glance.modelAlias.length === 0) {
    return 'Active model: (none selected — /model or Settings → Model)';
  }
  const label = glance.modelLabel ?? glance.modelAlias;
  const aliasPart =
    label !== glance.modelAlias ? `${label} (${glance.modelAlias})` : glance.modelAlias;
  return `Active model: ${aliasPart} · live session confirms`;
}

/** Live active provider from catalog entry for the session model alias. */
export function formatActiveProviderLine(glance: ProvidersApiSessionGlance): string {
  if (glance.sessionUnavailable === true) {
    return 'Active provider: (session unavailable)';
  }
  if (glance.providerId === undefined || glance.providerId.length === 0) {
    return 'Active provider: (unknown — catalog may not be loaded)';
  }
  const modelPart =
    glance.providerModel !== undefined &&
    glance.providerModel.length > 0 &&
    glance.providerModel !== glance.modelAlias
      ? ` · upstream ${glance.providerModel}`
      : '';
  return `Active provider: ${glance.providerId}${modelPart}`;
}

export function formatProvidersCatalogLine(glance: ProvidersApiSessionGlance): string | undefined {
  const models = glance.catalogModels;
  const providers = glance.catalogProviders;
  if (models === undefined && providers === undefined) return undefined;
  const modelCount = models ?? 0;
  const providerCount = providers ?? 0;
  if (modelCount === 0 && providerCount === 0) {
    return 'Catalog: not loaded — /login or liora provider catalog';
  }
  return `Catalog: ${String(modelCount)} models / ${String(providerCount)} providers`;
}

function firstNonBlank(env: NodeJS.ProcessEnv, keys: readonly string[]): boolean {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value !== undefined && value.length > 0) return true;
  }
  return false;
}

export function loadProvidersApiGlance(env: NodeJS.ProcessEnv = process.env): ProvidersApiGlanceInput {
  const configuredLabels = PROVIDER_API_KEY_ENVS.filter((spec) =>
    firstNonBlank(env, spec.envs),
  ).map((spec) => spec.label);

  return {
    configuredLabels,
    registryKeySet: firstNonBlank(env, ['KIMI_REGISTRY_API_KEY']),
    providerKeySet: firstNonBlank(env, ['KIMI_PROVIDER_API_KEY']),
  };
}

export function buildProvidersApiSettingsLines(input: ProvidersApiGlanceInput): readonly string[] {
  const envStatus =
    input.configuredLabels.length > 0
      ? `Detected (${input.configuredLabels.length}): ${input.configuredLabels.join(', ')}`
      : 'No common provider API keys detected in this process env.';

  const registryLine = input.registryKeySet
    ? 'KIMI_REGISTRY_API_KEY: set (models.dev catalog fetch)'
    : 'KIMI_REGISTRY_API_KEY: unset — optional catalog registry auth';
  const providerLine = input.providerKeySet
    ? 'KIMI_PROVIDER_API_KEY: set (CLI provider batch helpers)'
    : 'KIMI_PROVIDER_API_KEY: unset — optional provider CLI auth';

  const envCatalog = PROVIDER_API_KEY_ENVS.map(
    (spec) => `· ${spec.label}: ${spec.envs.join(' · ')}`,
  );

  const researchTips: string[] = [`· ${PROVIDERS_FREE_SEARCH_TIP}`];
  if (input.webSearchActive === true) {
    researchTips.unshift(`· ${SEARCH_PREFER_XAI_TIP}`);
  }

  const session = input.session;
  const sessionLines =
    session !== undefined
      ? (() => {
          const catalogLine = formatProvidersCatalogLine(session);
          return [
            '── Session (live) ───────────────────────────',
            formatActiveModelLine(session),
            formatActiveProviderLine(session),
            ...(catalogLine != null ? [catalogLine] : []),
            ...(session.routeLine != null && session.routeLine.length > 0
              ? [session.routeLine]
              : []),
            '',
          ];
        })()
      : [];

  return [
    '── Providers & API (read-only) ───────────────',
    'Credential posture — Sovereign Reform §9.2.',
    '',
    ...sessionLines,
    '── Status ───────────────────────────────────',
    envStatus,
    registryLine,
    providerLine,
    '',
    '── API key env names ────────────────────────',
    ...envCatalog,
    '',
    '── Tips ─────────────────────────────────────',
    '· /login — connect OAuth or add a catalog/custom provider',
    ...oauthAccountsResilienceTips(),
    '· liora provider … — CLI doctor, catalog, custom base URL, org',
    '· config.toml [providers.*] — api_key or env:VAR references',
    '· Never paste keys into the TUI — export env vars or use /login',
    ...researchTips,
    `· ${OSS_ABSORB_LICENSE_TIP}`,
    '',
    '── Related ──────────────────────────────────',
    '· Settings → Model / Model routing — pick active models',
    '· Settings → Search — research provider keys (Brave, Tavily, …)',
    '',
    'No key editor here — use /login, Accounts, or shell env.',
  ];
}
