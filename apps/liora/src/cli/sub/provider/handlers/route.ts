/**
 * `liora provider route *` handlers — model routing configuration.
 */

import { t } from '#/cli/i18n';
import type { LioraConfig, ProviderRouteStatus } from '@superliora/sdk';

import {
  buildRoutePreview,
  formatProviderRouteStatus,
  formatRoutePreview,
  formatRouteWeights,
  parseCooldownMs,
  parseFallbackModels,
  parsePreferredCredential,
  parseRouteWeights,
  parseRoutingStrategy,
  parseSessionAffinity,
  routeCandidateCredentialLabels,
  validatePreferredCredential,
  validateRouteWeights,
} from '../route-utils';
import { errorMessage, uniqueStrings, writeProviderErr, writeProviderOut } from '../shared';
import type {
  ConfigModelAlias,
  ProviderDeps,
  RouteAutoOptions,
  RoutePreview,
  RoutePreviewOptions,
  RouteSetOptions,
  RouteStatusOptions,
} from '../types';

export async function handleProviderRouteShow(
  deps: ProviderDeps,
  modelAlias: string,
): Promise<void> {
  const harness = deps.getHarness();
  await harness.ensureConfigFile();
  const config = await harness.getConfig();
  const model = config.models?.[modelAlias];
  if (model === undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.modelNotFound', { modelAlias });
    deps.exit(1);
  }

  writeProviderOut(deps, 'cli.runtime.provider.routeShowHeader', { modelAlias });
  writeProviderOut(deps, 'cli.runtime.provider.routeShowProvider', { provider: model.provider });
  writeProviderOut(deps, 'cli.runtime.provider.routeShowModel', { model: model.model });
  writeProviderOut(deps, 'cli.runtime.provider.routeShowFallbackModels', {
    fallbacks: (model.fallbackModels ?? []).join(', ') || t('cli.runtime.provider.valueNone'),
  });
  writeProviderOut(deps, 'cli.runtime.provider.routeShowStrategy', {
    strategy: model.routing?.strategy ?? t('cli.runtime.provider.valueAuto'),
  });
  writeProviderOut(deps, 'cli.runtime.provider.routeShowWeights', {
    weights: formatRouteWeights(model.routing?.weights),
  });
  writeProviderOut(deps, 'cli.runtime.provider.routeShowSessionAffinity', {
    value:
      model.routing?.sessionAffinity === true
        ? t('cli.runtime.provider.valueOn')
        : t('cli.runtime.provider.valueOff'),
  });
  writeProviderOut(deps, 'cli.runtime.provider.routeShowPreferredCredential', {
    value: model.routing?.preferredCredential ?? t('cli.runtime.provider.valueNone'),
  });
  writeProviderOut(deps, 'cli.runtime.provider.routeShowCooldownMs', {
    value:
      model.routing?.cooldownMs === undefined
        ? t('cli.runtime.provider.valueDefault')
        : String(model.routing.cooldownMs),
  });
}

export async function handleProviderRoutePreview(
  deps: ProviderDeps,
  modelAlias: string,
  opts: RoutePreviewOptions,
): Promise<void> {
  const harness = deps.getHarness();
  await harness.ensureConfigFile();
  const config = await harness.getConfig();
  let preview: RoutePreview;
  try {
    preview = buildRoutePreview(config, modelAlias);
  } catch (error) {
    deps.stderr.write(`${errorMessage(error)}\n`);
    deps.exit(1);
  }

  if (opts.json) {
    deps.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
    return;
  }
  deps.stdout.write(formatRoutePreview(preview));
}

export async function handleProviderRouteSet(
  deps: ProviderDeps,
  modelAlias: string,
  opts: RouteSetOptions,
): Promise<void> {
  if (
    opts.fallback === undefined &&
    opts.strategy === undefined &&
    opts.cooldownMs === undefined &&
    opts.weights === undefined &&
    opts.sessionAffinity === undefined &&
    opts.preferredCredential === undefined
  ) {
    writeProviderErr(deps, 'cli.runtime.provider.routeSetNothingToUpdate');
    deps.exit(1);
  }

  const harness = deps.getHarness();
  await harness.ensureConfigFile();
  const config = await harness.getConfig();
  const models = config.models ?? {};
  const model = models[modelAlias];
  if (model === undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.modelNotFound', { modelAlias });
    deps.exit(1);
  }

  const fallbackModels =
    opts.fallback === undefined ? model.fallbackModels : parseFallbackModels(opts.fallback);
  const missingFallback = fallbackModels?.find((alias) => models[alias] === undefined);
  if (missingFallback !== undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.fallbackModelNotConfigured', { fallback: missingFallback });
    deps.exit(1);
  }
  if (fallbackModels?.includes(modelAlias) === true) {
    writeProviderErr(deps, 'cli.runtime.provider.selfFallback');
    deps.exit(1);
  }

  const strategy =
    opts.strategy === undefined
      ? model.routing?.strategy
      : parseRoutingStrategy(opts.strategy, deps);
  const cooldownMs =
    opts.cooldownMs === undefined
      ? model.routing?.cooldownMs
      : parseCooldownMs(opts.cooldownMs, deps);
  const weights =
    opts.weights === undefined ? model.routing?.weights : parseRouteWeights(opts.weights, deps);
  const sessionAffinity =
    opts.sessionAffinity === undefined
      ? model.routing?.sessionAffinity
      : parseSessionAffinity(opts.sessionAffinity, deps);
  const preferredCredential =
    opts.preferredCredential === undefined
      ? model.routing?.preferredCredential
      : parsePreferredCredential(opts.preferredCredential);
  validateRouteWeights(weights, uniqueStrings([modelAlias, ...(fallbackModels ?? [])]), deps);
  validatePreferredCredential(
    preferredCredential,
    routeCandidateCredentialLabels(config, modelAlias, fallbackModels ?? []),
    deps,
  );
  const routing =
    strategy === undefined &&
    cooldownMs === undefined &&
    weights === undefined &&
    sessionAffinity !== true &&
    preferredCredential === undefined
      ? undefined
      : {
          strategy,
          cooldownMs,
          weights,
          sessionAffinity: sessionAffinity === true ? true : undefined,
          preferredCredential,
        };

  const nextModel: ConfigModelAlias = {
    ...model,
    fallbackModels,
    routing,
  };

  await harness.setConfig({
    models: {
      ...models,
      [modelAlias]: nextModel,
    },
  });
  writeProviderOut(deps, 'cli.runtime.provider.routeUpdated', { modelAlias });
}

export async function handleProviderRouteAuto(
  deps: ProviderDeps,
  modelAlias: string,
  opts: RouteAutoOptions,
): Promise<void> {
  const harness = deps.getHarness();
  await harness.ensureConfigFile();
  const config = await harness.getConfig();
  const models = config.models ?? {};
  const model = models[modelAlias];
  if (model === undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.modelNotFound', { modelAlias });
    deps.exit(1);
  }

  const fallbackModels =
    opts.fallback === undefined ? model.fallbackModels : parseFallbackModels(opts.fallback);
  const missingFallback = fallbackModels?.find((alias) => models[alias] === undefined);
  if (missingFallback !== undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.fallbackModelNotConfigured', { fallback: missingFallback });
    deps.exit(1);
  }
  if (fallbackModels?.includes(modelAlias) === true) {
    writeProviderErr(deps, 'cli.runtime.provider.selfFallback');
    deps.exit(1);
  }

  const routeAliases = uniqueStrings([modelAlias, ...(fallbackModels ?? [])]);
  const cooldownMs =
    opts.cooldownMs === undefined
      ? model.routing?.cooldownMs
      : parseCooldownMs(opts.cooldownMs, deps);
  const sessionAffinity =
    opts.sessionAffinity === undefined ? true : parseSessionAffinity(opts.sessionAffinity, deps);
  const preferredCredential =
    opts.preferredCredential === undefined
      ? model.routing?.preferredCredential
      : parsePreferredCredential(opts.preferredCredential);
  const weights = model.routing?.weights;

  validateRouteWeights(weights, routeAliases, deps);
  validatePreferredCredential(
    preferredCredential,
    routeCandidateCredentialLabels(config, modelAlias, fallbackModels ?? []),
    deps,
  );

  const nextModel: ConfigModelAlias = {
    ...model,
    fallbackModels,
    routing: {
      strategy: 'auto',
      cooldownMs,
      weights,
      sessionAffinity:  sessionAffinity ? true : undefined,
      preferredCredential,
    },
  };
  const nextConfig: LioraConfig = {
    ...config,
    models: {
      ...models,
      [modelAlias]: nextModel,
    },
  };
  const preview = buildRoutePreview(nextConfig, modelAlias);
  if (preview.candidates.length < 2) {
    writeProviderErr(deps, 'cli.runtime.provider.autoRouteNeedsCandidates', { modelAlias });
    deps.exit(1);
  }

  await harness.setConfig({ models: nextConfig.models });
  writeProviderOut(deps, 'cli.runtime.provider.autoRouteEnabled', {
    modelAlias,
    count: String(preview.candidates.length),
  });
  deps.stdout.write(formatRoutePreview(preview));
}

export async function handleProviderRouteReset(
  deps: ProviderDeps,
  sessionId: string,
): Promise<void> {
  const harness = deps.getHarness();
  const session = await harness.resumeSession({ id: sessionId });
  const status = await session.resetProviderRouteStatus();
  if (status === null) {
    writeProviderOut(deps, 'cli.runtime.provider.routeResetNone', { sessionId });
    return;
  }
  writeProviderOut(deps, 'cli.runtime.provider.routeResetDone', {
    modelAlias: status.modelAlias,
    sessionId,
    count: String(status.candidates.length),
  });
}

export async function handleProviderRouteStatus(
  deps: ProviderDeps,
  sessionId: string,
  opts: RouteStatusOptions,
): Promise<void> {
  const harness = deps.getHarness();
  const session = await harness.resumeSession({ id: sessionId });
  const routeStatus = (await session.getStatus()).providerRouteStatus ?? null;
  if (opts.json) {
    deps.stdout.write(`${JSON.stringify(routeStatus, null, 2)}\n`);
    return;
  }
  if (routeStatus === null) {
    writeProviderOut(deps, 'cli.runtime.provider.routeStatusNone', { sessionId });
    return;
  }
  deps.stdout.write(formatProviderRouteStatus(routeStatus, Date.now()));
}
