/**
 * `liora provider model add` — add an arbitrary model id to an existing provider.
 *
 * Intended for "hidden / just-released" models: when models.dev / a provider's
 * `/models` endpoint has not yet synced a new SKU, users can still use it by
 * wire id. The entry is persisted as `models["<provider>/<model>"]` and
 * preserved across catalog refreshes as a user alias.
 */

import type { LioraConfig } from '@superliora/sdk';
import { applyXaiPricingSafeContextTokens } from '@superliora/oauth';

import { loadCatalog } from '#/utils/catalog-cache';
import { lookupModelCapability, probeModelsEndpoint } from '#/utils/custom-provider';
import { errorMessage, writeProviderErr, writeProviderOut } from '../shared';
import type { ProviderDeps } from '../types';

export interface ModelAddOptions {
  readonly context?: string;
  readonly displayName?: string;
  readonly thinking?: boolean;
  readonly setDefault?: boolean;
}

function parsePositiveInt(raw: string | undefined, label: string, deps: ProviderDeps): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    deps.stderr.write(`${label} must be a positive integer.\n`);
    deps.exit(1);
  }
  return n;
}

export async function handleProviderModelAdd(
  deps: ProviderDeps,
  providerId: string,
  modelId: string,
  opts: ModelAddOptions,
): Promise<void> {
  const pid = providerId.trim();
  const mid = modelId.trim();
  if (pid.length === 0) {
    deps.stderr.write('Provider id is required.\n');
    deps.exit(1);
  }
  if (mid.length === 0) {
    deps.stderr.write('Model id is required.\n');
    deps.exit(1);
  }
  if (/\s/.test(pid)) {
    deps.stderr.write('Provider id cannot contain whitespace.\n');
    deps.exit(1);
  }

  const harness = deps.getHarness();
  await harness.ensureConfigFile();
  const config: LioraConfig = await harness.getConfig();
  const provider = (config.providers as Record<string, unknown>)[pid] as
    | { baseUrl?: string; apiKey?: string; type?: string }
    | undefined;
  if (provider === undefined) {
    writeProviderErr(deps, 'cli.runtime.provider.notFound', { providerId: pid });
    deps.exit(1);
  }

  const alias = `${pid}/${mid}`;
  if (config.models?.[alias] !== undefined) {
    deps.stderr.write(`Model alias "${alias}" already exists — overwriting.\n`);
  }

  // Try to enrich from catalog / /models probe so thinking + context are auto-filled.
  let maxContext: number | undefined = parsePositiveInt(opts.context, 'Context window', deps);
  let thinking = opts.thinking === true;
  let supportEfforts: readonly string[] | undefined;
  let enrichedDisplayName = opts.displayName?.trim() || undefined;

  try {
    const catalog = await loadCatalog().catch(() => undefined);
    if (catalog !== undefined) {
      const hint = lookupModelCapability(catalog, pid, mid);
      if (hint !== undefined) {
        if (maxContext === undefined && hint.maxContextTokens !== undefined) maxContext = hint.maxContextTokens;
        if (!thinking && hint.thinking) thinking = true;
        if (hint.supportEfforts !== undefined) supportEfforts = hint.supportEfforts;
        if (enrichedDisplayName === undefined) {
          const entry = catalog[pid]?.models?.[mid];
          if (typeof entry?.name === 'string' && entry.name.length > 0) enrichedDisplayName = entry.name;
        }
      }
    }
  } catch {
    // best-effort
  }

  if (thinking === false && maxContext === undefined) {
    // Probe the provider's /models endpoint when catalog had no hint.
    try {
      const baseUrl = provider?.baseUrl;
      if (typeof baseUrl === 'string' && baseUrl.length > 0) {
        const probed = await probeModelsEndpoint(baseUrl, provider?.apiKey, mid);
        if (probed !== undefined) {
          if (probed.thinking) thinking = true;
          if (probed.supportEfforts !== undefined) supportEfforts = probed.supportEfforts;
        }
      }
    } catch {
      // ignore
    }
  }

  const defaultContext = 128000;
  const advertisedContext = maxContext ?? defaultContext;
  const maxContextSize = applyXaiPricingSafeContextTokens(advertisedContext, {
    provider: pid,
    model: mid,
  });

  const capabilities = thinking ? ['thinking', 'tool_use'] : ['tool_use'];

  config.models = {
    ...config.models,
    [alias]: {
      ...config.models?.[alias],
      provider: pid,
      model: mid,
      maxContextSize,
      capabilities,
      displayName: enrichedDisplayName ?? mid,
      userManaged: true,
      ...(supportEfforts !== undefined && supportEfforts.length > 0 ? { supportEfforts: [...supportEfforts] } : {}),
    },
  };

  if (opts.setDefault === true) {
    config.defaultModel = alias;
    config.defaultThinking = thinking;
  }

  await harness.setConfig({
    providers: config.providers,
    models: config.models,
    ...(opts.setDefault === true ? { defaultModel: config.defaultModel, defaultThinking: config.defaultThinking } : {}),
  });

  deps.stdout.write(`Added custom model "${alias}" to provider "${pid}" (model "${mid}").\n`);
  if (opts.setDefault === true) writeProviderOut(deps, 'cli.runtime.provider.defaultModelSetAlias', { alias });
}
