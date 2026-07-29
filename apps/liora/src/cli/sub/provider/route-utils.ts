/**
 * Route preview, formatting, and parsing utilities for provider CLI handlers.
 */

import type { LioraConfig, ProviderRouteStatus } from '@superliora/sdk';

import { t } from '#/cli/i18n';

import {
  providerCredentialSources,
  providerFallbackAuth,
  providerFallbackCredentialSource,
  providerHasOAuth,
} from './credential';
import {
  aliasWord,
  formatDuration,
  formatPercent,
  nonEmptyString,
  uniqueStrings,
  writeProviderErr,
  writeProviderOut,
} from './shared';
import type {
  ConfigModelAlias,
  ProviderAutoRouteResult,
  ProviderDeps,
  RoutePreview,
  RoutePreviewCandidate,
} from './types';

/* ------------------------------------------------------------------ */
/*  Route preview building                                             */
/* ------------------------------------------------------------------ */

export function buildRoutePreview(config: LioraConfig, modelAlias: string): RoutePreview {
  const models = config.models ?? {};
  const model = models[modelAlias];
  if (model === undefined) {
    throw new Error(t('cli.runtime.provider.modelNotFoundThrow', { modelAlias }));
  }
  const fallbackModels = model.fallbackModels ?? [];
  const candidateAliases = uniqueStrings([modelAlias, ...fallbackModels]);
  const preferredCredential = model.routing?.preferredCredential;
  const candidates = candidateAliases
    .flatMap((alias) =>
      routePreviewCandidatesForAlias(config, alias, model.routing?.weights?.[alias]),
    )
    .map((candidate) => ({
      ...candidate,
      preferred: matchesRoutePreviewPreferred(preferredCredential, candidate) ? true : undefined,
    }));
  const hasLocalLimits = candidates.some(
    (candidate) => candidate.rpm !== undefined || candidate.tpm !== undefined,
  );
  const active =
    fallbackModels.length > 0 ||
    model.routing !== undefined ||
    candidates.length > 1 ||
    hasLocalLimits;
  const strategy = model.routing?.strategy ?? (active ? 'auto' : 'fallback');
  return {
    modelAlias,
    strategy,
    active,
    fallbackModels,
    sessionAffinity: model.routing?.sessionAffinity,
    preferredCredential: model.routing?.preferredCredential,
    candidates,
  };
}

export function routePreviewCandidatesForAlias(
  config: LioraConfig,
  modelAlias: string,
  weight: number | undefined,
): RoutePreviewCandidate[] {
  const model = config.models?.[modelAlias];
  if (model === undefined) {
    throw new Error(t('cli.runtime.provider.fallbackModelNotConfiguredThrow', { modelAlias }));
  }
  const providerName = model.provider ?? config.defaultProvider;
  if (providerName === undefined) {
    throw new Error(t('cli.runtime.provider.modelMustDefineProvider', { modelAlias }));
  }
  const provider = config.providers[providerName];
  if (provider === undefined) {
    throw new Error(
      t('cli.runtime.provider.providerNotConfiguredForModel', { providerName, modelAlias }),
    );
  }

  const credentialSources = providerCredentialSources(provider);
  if (credentialSources.length === 0) {
    return [
      {
        modelAlias,
        providerName,
        providerType: provider.type,
        providerModel: model.model,
        weight,
        credentialSource: providerFallbackCredentialSource(provider),
        auth: providerFallbackAuth(provider),
        baseUrl: nonEmptyString(provider.baseUrl),
      },
    ];
  }

  return credentialSources.map((source) => ({
    modelAlias,
    providerName,
    providerType: provider.type,
    providerModel: model.model,
    weight,
    credentialLabel: source.credentialLabel,
    credentialSource: source.credentialSource,
    auth: source.auth,
    baseUrl: source.baseUrl ?? nonEmptyString(provider.baseUrl),
    rpm: source.rpm,
    tpm: source.tpm,
  }));
}

export function providerAutoRouteModels(
  config: LioraConfig,
  providerId: string,
): ProviderAutoRouteResult {
  const models = config.models ?? {};
  const nextModels: NonNullable<LioraConfig['models']> = { ...models };
  const aliases: string[] = [];

  for (const [alias, model] of Object.entries(models).toSorted(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (model.provider !== providerId) continue;
    const nextModel: ConfigModelAlias = {
      ...model,
      routing: {
        strategy: 'auto',
        cooldownMs: model.routing?.cooldownMs,
        weights: model.routing?.weights,
        sessionAffinity:
          model.routing?.sessionAffinity === undefined ? true : model.routing.sessionAffinity,
        preferredCredential: model.routing?.preferredCredential,
      },
    };
    const previewConfig: LioraConfig = {
      ...config,
      models: {
        ...nextModels,
        [alias]: nextModel,
      },
    };
    let preview: RoutePreview;
    try {
      preview = buildRoutePreview(previewConfig, alias);
    } catch {
      continue;
    }
    if (preview.candidates.length < 2) continue;
    nextModels[alias] = nextModel;
    aliases.push(alias);
  }

  return aliases.length === 0 ? { aliases } : { aliases, models: nextModels };
}

export function writeProviderAutoRouteSummary(
  deps: ProviderDeps,
  providerId: string,
  result: ProviderAutoRouteResult | undefined,
): void {
  if (result === undefined) return;
  if (result.aliases.length === 0) {
    writeProviderOut(deps, 'cli.runtime.provider.autoRouteNoCandidates', { providerId });
    return;
  }
  writeProviderOut(deps, 'cli.runtime.provider.autoRouteEnabledSummary', {
    count: String(result.aliases.length),
    aliasWord: aliasWord(result.aliases.length),
    aliases: result.aliases.join(', '),
  });
}

/* ------------------------------------------------------------------ */
/*  Route formatting                                                   */
/* ------------------------------------------------------------------ */

export function formatRoutePreview(preview: RoutePreview): string {
  const lines = [
    t('cli.runtime.provider.routePreviewHeader', { modelAlias: preview.modelAlias }),
    t('cli.runtime.provider.routePreviewActive', {
      value: preview.active ? t('cli.runtime.provider.valueYes') : t('cli.runtime.provider.valueNo'),
    }),
    t('cli.runtime.provider.routePreviewStrategy', { strategy: preview.strategy }),
    t('cli.runtime.provider.routePreviewFallbackModels', {
      fallbacks:
        preview.fallbackModels.length === 0
          ? t('cli.runtime.provider.valueNone')
          : preview.fallbackModels.join(', '),
    }),
    t('cli.runtime.provider.routePreviewSessionAffinity', {
      value:
        preview.sessionAffinity === true
          ? t('cli.runtime.provider.valueOn')
          : t('cli.runtime.provider.valueOff'),
    }),
    t('cli.runtime.provider.routePreviewPreferredCredential', {
      value: preview.preferredCredential ?? t('cli.runtime.provider.valueNone'),
    }),
    t('cli.runtime.provider.routePreviewCandidatesLabel'),
    ...preview.candidates.map((candidate, index) =>
      formatRoutePreviewCandidate(candidate, index),
    ),
  ];
  return `${lines.join('\n')}\n`;
}

function formatRoutePreviewCandidate(candidate: RoutePreviewCandidate, index: number): string {
  const parts = [
    `    #${String(index + 1)}`,
    `alias=${candidate.modelAlias}`,
    `provider=${candidate.providerName}`,
    `type=${candidate.providerType}`,
    `model=${candidate.providerModel}`,
    `auth=${candidate.auth}`,
    `source=${candidate.credentialSource}`,
  ];
  if (candidate.credentialLabel !== undefined) {
    parts.push(`credential=${candidate.credentialLabel}`);
  }
  if (candidate.preferred === true) {
    parts.push('preferred');
  }
  if (candidate.weight !== undefined) {
    parts.push(`weight=${String(candidate.weight)}`);
  }
  if (candidate.rpm !== undefined) {
    parts.push(`rpm=${String(candidate.rpm)}`);
  }
  if (candidate.tpm !== undefined) {
    parts.push(`tpm=${String(candidate.tpm)}`);
  }
  if (candidate.baseUrl !== undefined) {
    parts.push(`base_url=${candidate.baseUrl}`);
  }
  return parts.join('  ');
}

export function formatProviderRouteStatus(status: ProviderRouteStatus, now: number): string {
  const affinityText = status.sessionAffinity === true ? t('cli.runtime.provider.routeHealthAffinityOn') : '';
  const preferredText =
    status.preferredCredential === undefined
      ? ''
      : t('cli.runtime.provider.routeHealthPreferred', { credential: status.preferredCredential });
  const lines = [
    t('cli.runtime.provider.routeHealthHeader', {
      modelAlias: status.modelAlias,
      strategy: status.strategy,
      affinityText,
      preferredText,
    }),
    ...status.candidates.map((candidate, index) =>
      formatProviderRouteCandidate(candidate, index, now),
    ),
  ];
  return `${lines.join('\n')}\n`;
}

function formatProviderRouteCandidate(
  candidate: ProviderRouteStatus['candidates'][number],
  index: number,
  now: number,
): string {
  const cooling = candidate.cooldownUntil !== undefined && candidate.cooldownUntil > now;
  const state = cooling
    ? t('cli.runtime.provider.routeHealthCooling', {
        duration: formatDuration(candidate.cooldownUntil! - now),
      })
    : t('cli.runtime.provider.routeHealthReady');
  const parts = [
    `  #${String(index + 1)}`,
    state,
    `alias=${candidate.modelAlias}`,
    `provider=${candidate.providerName}`,
    `model=${candidate.providerModel}`,
  ];
  if (candidate.credentialLabel !== undefined) {
    parts.push(`credential=${candidate.credentialLabel}`);
  }
  if (candidate.baseUrl !== undefined) {
    parts.push(`base_url=${candidate.baseUrl}`);
  }
  if (candidate.preferred === true) {
    parts.push('preferred');
  }
  if (candidate.pinned === true) {
    parts.push('pinned');
  }
  if (candidate.weight !== undefined) {
    parts.push(`weight=${String(candidate.weight)}`);
  }
  if (candidate.avgLatencyMs !== undefined) {
    parts.push(`latency=${String(candidate.avgLatencyMs)}ms`);
  }
  if (candidate.lastLatencyMs !== undefined) {
    parts.push(`last_latency=${String(candidate.lastLatencyMs)}ms`);
  }
  if (candidate.rateLimitHeadroom !== undefined) {
    parts.push(`headroom=${formatPercent(candidate.rateLimitHeadroom)}`);
  }
  if (cooling && candidate.cooldownKind !== undefined) {
    parts.push(`cooldown=${candidate.cooldownKind}`);
  }
  if (candidate.rateLimits !== undefined && candidate.rateLimits.length > 0) {
    parts.push(`limits=${formatProviderRouteRateLimits(candidate.rateLimits, now)}`);
  }
  parts.push(`ok=${String(candidate.successCount ?? 0)}`);
  parts.push(`fail=${String(candidate.failureCount ?? 0)}`);
  if (candidate.lastFailureKind !== undefined) {
    parts.push(`last_failure=${candidate.lastFailureKind}`);
  }
  if (candidate.lastFailureAt !== undefined) {
    parts.push(`last_failure_at=${new Date(candidate.lastFailureAt).toISOString()}`);
  }
  if (candidate.lastSuccessAt !== undefined) {
    parts.push(`last_success_at=${new Date(candidate.lastSuccessAt).toISOString()}`);
  }
  return parts.join('  ');
}

function formatProviderRouteRateLimits(
  rateLimits: NonNullable<ProviderRouteStatus['candidates'][number]['rateLimits']>,
  now: number,
): string {
  return rateLimits
    .map((rateLimit) => {
      const quota =
        rateLimit.remaining === undefined && rateLimit.limit === undefined
          ? rateLimit.name
          : `${rateLimit.name}:${String(rateLimit.remaining ?? '?')}/${String(rateLimit.limit ?? '?')}`;
      return rateLimit.resetAt === undefined
        ? quota
        : `${quota}@${formatDuration(rateLimit.resetAt - now)}`;
    })
    .join(',');
}

export function formatRouteWeights(weights: Readonly<Record<string, number>> | undefined): string {
  if (weights === undefined || Object.keys(weights).length === 0) {
    return t('cli.runtime.provider.valueNone');
  }
  return Object.entries(weights)
    .map(([alias, weight]) => `${alias}=${String(weight)}`)
    .join(', ');
}

/* ------------------------------------------------------------------ */
/*  Route parsing and validation                                       */
/* ------------------------------------------------------------------ */

export function parseFallbackModels(value: string): string[] {
  return uniqueStrings(value.split(',').map((entry) => entry.trim()));
}

export function parseRoutingStrategy(
  value: string,
  deps: ProviderDeps,
):
  | 'auto'
  | 'fallback'
  | 'fill_first'
  | 'round_robin'
  | 'weighted_round_robin'
  | 'least_used'
  | 'lowest_latency'
  | 'rate_limit_aware'
  | 'random' {
  if (
    value === 'auto' ||
    value === 'fallback' ||
    value === 'fill_first' ||
    value === 'round_robin' ||
    value === 'weighted_round_robin' ||
    value === 'least_used' ||
    value === 'lowest_latency' ||
    value === 'rate_limit_aware' ||
    value === 'random'
  ) {
    return value;
  }
  writeProviderErr(deps, 'cli.runtime.provider.routingStrategyInvalid');
  deps.exit(1);
}

export function parseCooldownMs(value: string, deps: ProviderDeps): number {
  const cooldownMs = Number(value);
  if (!Number.isInteger(cooldownMs) || cooldownMs < 0) {
    writeProviderErr(deps, 'cli.runtime.provider.cooldownNonNegative');
    deps.exit(1);
  }
  return cooldownMs;
}

export function parseSessionAffinity(value: string, deps: ProviderDeps): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'on' || normalized === 'true' || normalized === '1') return true;
  if (normalized === 'off' || normalized === 'false' || normalized === '0') return false;
  writeProviderErr(deps, 'cli.runtime.provider.sessionAffinityOnOff');
  deps.exit(1);
}

export function parsePreferredCredential(value: string): string | undefined {
  return nonEmptyString(value);
}

export function parseRouteWeights(
  value: string,
  deps: ProviderDeps,
): Record<string, number> | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const weights: Record<string, number> = {};
  for (const entry of trimmed.split(',')) {
    const [rawAlias, rawWeight, ...extra] = entry.split('=');
    const alias = rawAlias?.trim() ?? '';
    const weightText = rawWeight?.trim() ?? '';
    if (alias.length === 0 || weightText.length === 0 || extra.length > 0) {
      writeProviderErr(deps, 'cli.runtime.provider.weightsFormat');
      deps.exit(1);
    }
    const weight = Number(weightText);
    if (!Number.isInteger(weight) || weight <= 0) {
      writeProviderErr(deps, 'cli.runtime.provider.routeWeightsPositive');
      deps.exit(1);
    }
    weights[alias] = weight;
  }
  return weights;
}

export function validateRouteWeights(
  weights: Readonly<Record<string, number>> | undefined,
  routeAliases: readonly string[],
  deps: ProviderDeps,
): void {
  if (weights === undefined) return;
  const routeAliasSet = new Set(routeAliases);
  for (const alias of Object.keys(weights)) {
    if (!routeAliasSet.has(alias)) {
      writeProviderErr(deps, 'cli.runtime.provider.routeWeightNotInRoute', { alias });
      deps.exit(1);
    }
  }
}

export function validatePreferredCredential(
  preferredCredential: string | undefined,
  labels: readonly string[],
  deps: ProviderDeps,
): void {
  if (preferredCredential === undefined) return;
  if (labels.includes(preferredCredential)) return;
  writeProviderErr(deps, 'cli.runtime.provider.preferredCredentialInvalid', {
    credential: preferredCredential,
  });
  deps.exit(1);
}

export function routeCandidateCredentialLabels(
  config: LioraConfig,
  modelAlias: string,
  fallbackModels: readonly string[],
): string[] {
  const candidates = uniqueStrings([modelAlias, ...fallbackModels]).flatMap((alias) =>
    routePreviewCandidatesForAlias(config, alias, undefined),
  );
  return uniqueStrings(
    candidates.flatMap((candidate) => {
      if (candidate.credentialLabel === undefined) return [];
      return [
        candidate.credentialLabel,
        `${candidate.modelAlias}:${candidate.credentialLabel}`,
        `${candidate.providerName}:${candidate.credentialLabel}`,
      ];
    }),
  );
}

function matchesRoutePreviewPreferred(
  preferredCredential: string | undefined,
  candidate: RoutePreviewCandidate,
): boolean {
  const preferred = preferredCredential?.trim();
  const label = candidate.credentialLabel?.trim();
  if (preferred === undefined || preferred.length === 0 || label === undefined || label.length === 0) {
    return false;
  }
  return (
    preferred === label ||
    preferred === `${candidate.modelAlias}:${label}` ||
    preferred === `${candidate.providerName}:${label}`
  );
}

/* ------------------------------------------------------------------ */
/*  Model display helpers                                              */
/* ------------------------------------------------------------------ */

export function formatAliasListLabel(alias: string, model: ConfigModelAlias | undefined): string {
  const displayName = modelDisplayName(model);
  return displayName === undefined ? alias : `${alias} (${displayName})`;
}

export function formatModelSelectionLabel(alias: string, model: ConfigModelAlias | undefined): string {
  const displayName = modelDisplayName(model);
  return displayName === undefined ? alias : `${displayName} (${alias})`;
}

function modelDisplayName(model: ConfigModelAlias | undefined): string | undefined {
  const displayName = model?.displayName?.trim();
  if (displayName === undefined || displayName.length === 0) return undefined;
  if (displayName === model?.model) return undefined;
  return displayName;
}

export function providerSourceLabel(provider: LioraConfig['providers'][string]): string {
  const source = provider.source;
  if (source !== undefined) {
    if (source['kind'] === 'apiJson' && typeof source['url'] === 'string') {
      return `apiJson(${source['url']})`;
    }
  }
  if (providerHasOAuth(provider)) return 'oauth';
  return 'inline';
}
