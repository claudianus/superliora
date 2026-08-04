import {
  applyCustomRegistryProvider,
  removeCustomRegistryProvider,
} from './custom-registry';
import {
  applyManagedKimiCodeConfig,
  fetchManagedKimiCodeModels,
  SUPERLIORA_PLATFORM_ID,
  SUPERLIORA_PROVIDER_NAME,
  resolveKimiCodeRuntimeAuth,
  type ManagedKimiConfigShape,
  type ManagedKimiOAuthRef,
} from '../kimi';
import {
  applyCursorOAuthModelAliases,
  CURSOR_OAUTH_PROVIDER_ID,
  fetchCursorAvailableModels,
} from '../profiles/cursor-available-models';
import {
  applyOpenPlatformConfig,
  fetchOpenPlatformModels,
  filterModelsByPrefix,
  getOpenPlatformById,
  isOpenPlatformId,
} from './open-platform';
import type { CustomRegistrySource } from './custom-registry';
import {
  clampDanglingDefault,
  clearDefaultThinkingWhenDefaultRemoved,
  collectModelIdsForAliases,
  computeChanges,
  customRegistrySourceCredentialKey,
  customRegistrySourceKey,
  fetchCustomRegistryFromSources,
  pickDefaultModel,
  preserveUserProviderAliases,
  providerAliasKeys,
  providerConfigEqual,
  providerModelsEqual,
  providerRefreshAliasKeys,
  readCustomRegistrySource,
  readProvider,
  restoreDefaultSelection,
  restoreProviderAliases,
} from './refreshProviderModels-helpers';

/**
 * Host capabilities the refresh orchestrator needs. Intentionally typed against
 * {@link ManagedKimiConfigShape} (the oauth package's own minimal config shape)
 * rather than the SDK's full `LioraConfig`, so this module has no dependency on
 * `agent-core` / the SDK and can be reused by both the CLI and the daemon.
 */
export interface RefreshProviderHost {
  getConfig(): Promise<ManagedKimiConfigShape>;
  removeProvider(providerId: string): Promise<ManagedKimiConfigShape>;
  setConfig(patch: ManagedKimiConfigShape): Promise<ManagedKimiConfigShape>;
  resolveOAuthToken(providerName: string, oauthRef?: ManagedKimiOAuthRef): Promise<string>;
}

export interface ProviderChange {
  readonly providerId: string;
  /** User-facing name when available. */
  readonly providerName: string;
  readonly added: number;
  readonly removed: number;
}

export interface RefreshResult {
  /** Providers whose model list actually changed. */
  readonly changed: readonly ProviderChange[];
  /** Providers whose model list stayed identical after refresh. */
  readonly unchanged: readonly string[];
  readonly failed: ReadonlyArray<{ readonly provider: string; readonly reason: string }>;
}

export type RefreshProviderScope = 'all' | 'oauth';

export interface RefreshProviderOptions {
  readonly scope?: RefreshProviderScope;
  /**
   * Refresh only this provider. When set, managed / open-platform branches
   * skip every other provider; for a custom-registry provider the registry
   * group it belongs to is fetched but only the target entry is applied.
   */
  readonly providerId?: string;
}

/**
 * Refresh remote model metadata for the configured providers and persist any
 * changes through the host. Handles three provider kinds, in order:
 *
 *  1. Managed SuperLiora (OAuth) — `GET /models` against the runtime endpoint.
 *  2. Open platforms (moonshot-cn, moonshot-ai, …) — platform catalog fetch.
 *  3. Cursor OAuth — `AvailableModels` Connect RPC when `cursor-oauth` is configured.
 *  4. Custom registries (models.dev-style, keyed by `provider.source`).
 *
 * Each branch diffs old vs new and only writes when something actually changed
 * (`removeProvider` then `setConfig`). Failures are collected per-provider and
 * never abort the whole refresh. Pass `providerId` to scope the refresh to a
 * single provider; pass `scope: 'oauth'` to refresh only the managed provider.
 */
export async function refreshProviderModels(
  host: RefreshProviderHost,
  options: RefreshProviderOptions = {},
): Promise<RefreshResult> {
  const changed: ProviderChange[] = [];
  const unchanged: string[] = [];
  const failed: Array<{ provider: string; reason: string }> = [];
  const scope = options.scope ?? 'all';
  const targetId = options.providerId;

  let config = await host.getConfig();

  // ---------------------------------------------------------------------------
  // 1. Managed SuperLiora (OAuth)
  // ---------------------------------------------------------------------------
  const managedProvider = readProvider(config, SUPERLIORA_PROVIDER_NAME);
  const managedWanted = targetId === undefined || targetId === SUPERLIORA_PROVIDER_NAME;
  if (
    managedWanted &&
    managedProvider !== undefined &&
    managedProvider.type === 'kimi' &&
    managedProvider.oauth !== undefined
  ) {
    try {
      const auth = resolveKimiCodeRuntimeAuth({
        configuredBaseUrl: managedProvider.baseUrl,
        configuredOAuthRef: managedProvider.oauth ?? undefined,
      });
      const accessToken = await host.resolveOAuthToken(SUPERLIORA_PROVIDER_NAME, auth.oauthRef);
      const models = await fetchManagedKimiCodeModels({
        accessToken,
        baseUrl: auth.baseUrl,
      });
      if (models.length > 0) {
        const next = structuredClone(config);
        applyManagedKimiCodeConfig(next, {
          models,
          baseUrl: auth.baseUrl,
          oauthKey: auth.oauthRef.key,
          oauthHost: auth.oauthRef.oauthHost,
          preserveDefaultModel: true,
        });
        const refreshedAliasKeys = providerRefreshAliasKeys(
          config,
          next,
          SUPERLIORA_PROVIDER_NAME,
          `${SUPERLIORA_PLATFORM_ID}/`,
        );
        restoreProviderAliases(
          next,
          preserveUserProviderAliases(config, SUPERLIORA_PROVIDER_NAME, refreshedAliasKeys),
        );
        restoreDefaultSelection(next, config.defaultModel, config.defaultThinking);
        clampDanglingDefault(next);
        clearDefaultThinkingWhenDefaultRemoved(next, config.defaultModel);

        if (providerModelsEqual(config, next, SUPERLIORA_PROVIDER_NAME, refreshedAliasKeys)) {
          unchanged.push(SUPERLIORA_PROVIDER_NAME);
        } else {
          const { added, removed } = computeChanges(
            collectModelIdsForAliases(config, refreshedAliasKeys),
            collectModelIdsForAliases(next, refreshedAliasKeys),
          );
          await host.removeProvider(SUPERLIORA_PROVIDER_NAME);
          config = await host.setConfig({
            providers: next.providers,
            models: next.models,
            defaultModel: next.defaultModel,
            defaultThinking: next.defaultThinking,
          });
          changed.push({
            providerId: SUPERLIORA_PROVIDER_NAME,
            providerName: 'SuperLiora',
            added,
            removed,
          });
        }
      }
    } catch (error) {
      failed.push({
        provider: SUPERLIORA_PROVIDER_NAME,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (scope === 'oauth' || targetId === SUPERLIORA_PROVIDER_NAME) {
    return { changed, unchanged, failed };
  }

  // ---------------------------------------------------------------------------
  // 2. Open Platforms (moonshot-cn, moonshot-ai, …)
  // ---------------------------------------------------------------------------
  const openPlatformIds = Object.keys(config.providers).filter((id) => isOpenPlatformId(id));
  for (const providerId of openPlatformIds) {
    if (targetId !== undefined && targetId !== providerId) continue;
    const platform = getOpenPlatformById(providerId);
    if (platform === undefined) continue;

    const providerConfig = readProvider(config, providerId);
    if (providerConfig === undefined) continue;
    const apiKey = providerConfig.apiKey;
    if (typeof apiKey !== 'string' || apiKey.length === 0) continue;

    try {
      let models = await fetchOpenPlatformModels(platform, apiKey);
      models = filterModelsByPrefix(models, platform);
      if (models.length === 0) continue;

      const selectedModelId = pickDefaultModel(config, providerId, models);
      const selectedModel = models.find((m) => m.id === selectedModelId);
      if (selectedModel === undefined) continue;
      const next = structuredClone(config);
      applyOpenPlatformConfig(next, {
        platform,
        models,
        selectedModel,
        thinking: false,
        apiKey,
      });
      const refreshedAliasKeys = providerRefreshAliasKeys(
        config,
        next,
        providerId,
        `${providerId}/`,
      );
      restoreProviderAliases(next, preserveUserProviderAliases(config, providerId, refreshedAliasKeys));
      restoreDefaultSelection(next, config.defaultModel, config.defaultThinking);
      clampDanglingDefault(next);
      clearDefaultThinkingWhenDefaultRemoved(next, config.defaultModel);

      if (providerModelsEqual(config, next, providerId, refreshedAliasKeys)) {
        unchanged.push(providerId);
      } else {
        const { added, removed } = computeChanges(
          collectModelIdsForAliases(config, refreshedAliasKeys),
          collectModelIdsForAliases(next, refreshedAliasKeys),
        );
        await host.removeProvider(providerId);
        config = await host.setConfig({
          providers: next.providers,
          models: next.models,
          defaultModel: next.defaultModel,
          defaultThinking: next.defaultThinking,
        });
        changed.push({
          providerId,
          providerName: platform.name,
          added,
          removed,
        });
      }
    } catch (error) {
      failed.push({
        provider: providerId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Cursor OAuth (AvailableModels)
  // ---------------------------------------------------------------------------
  const cursorWanted = targetId === undefined || targetId === CURSOR_OAUTH_PROVIDER_ID;
  if (cursorWanted) {
    const cursorProvider = readProvider(config, CURSOR_OAUTH_PROVIDER_ID);
    const cursorOAuth = cursorProvider?.oauth;
    if (
      cursorProvider !== undefined &&
      cursorProvider.type === 'cursor' &&
      cursorOAuth !== undefined &&
      typeof cursorOAuth === 'object' &&
      cursorOAuth !== null
    ) {
      try {
        const accessToken = await host.resolveOAuthToken(
          CURSOR_OAUTH_PROVIDER_ID,
          cursorOAuth as ManagedKimiOAuthRef,
        );
        const discovered = await fetchCursorAvailableModels({ accessToken });
        if (discovered !== undefined && discovered.length > 0) {
          const next = structuredClone(config);
          applyCursorOAuthModelAliases(next, discovered);
          const refreshedAliasKeys = providerRefreshAliasKeys(
            config,
            next,
            CURSOR_OAUTH_PROVIDER_ID,
            `${CURSOR_OAUTH_PROVIDER_ID}/`,
          );
          restoreProviderAliases(
            next,
            preserveUserProviderAliases(config, CURSOR_OAUTH_PROVIDER_ID, refreshedAliasKeys),
          );
          restoreDefaultSelection(next, config.defaultModel, config.defaultThinking);
          clampDanglingDefault(next);
          clearDefaultThinkingWhenDefaultRemoved(next, config.defaultModel);

          if (providerModelsEqual(config, next, CURSOR_OAUTH_PROVIDER_ID, refreshedAliasKeys)) {
            unchanged.push(CURSOR_OAUTH_PROVIDER_ID);
          } else {
            const { added, removed } = computeChanges(
              collectModelIdsForAliases(config, refreshedAliasKeys),
              collectModelIdsForAliases(next, refreshedAliasKeys),
            );
            await host.removeProvider(CURSOR_OAUTH_PROVIDER_ID);
            config = await host.setConfig({
              providers: next.providers,
              models: next.models,
              defaultModel: next.defaultModel,
              defaultThinking: next.defaultThinking,
            });
            changed.push({
              providerId: CURSOR_OAUTH_PROVIDER_ID,
              providerName: 'Cursor',
              added,
              removed,
            });
          }
        }
      } catch (error) {
        failed.push({
          provider: CURSOR_OAUTH_PROVIDER_ID,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Custom Registry providers (grouped by URL, with API-key candidates)
  // ---------------------------------------------------------------------------
  const customSources = new Map<
    string,
    {
      readonly sources: CustomRegistrySource[];
      readonly sourceKeys: Set<string>;
      readonly providerIds: string[];
    }
  >();
  for (const providerId of Object.keys(config.providers)) {
    if (providerId === SUPERLIORA_PROVIDER_NAME) continue;
    if (isOpenPlatformId(providerId)) continue;
    const provider = readProvider(config, providerId);
    if (provider === undefined) continue;
    const source = readCustomRegistrySource(provider);
    if (source === undefined) continue;
    const key = customRegistrySourceKey(source);
    const sourceKey = customRegistrySourceCredentialKey(source);
    const entry = customSources.get(key);
    if (entry !== undefined) {
      if (!entry.sourceKeys.has(sourceKey)) {
        entry.sources.push(source);
        entry.sourceKeys.add(sourceKey);
      }
      entry.providerIds.push(providerId);
    } else {
      customSources.set(key, {
        sources: [source],
        sourceKeys: new Set([sourceKey]),
        providerIds: [providerId],
      });
    }
  }

  for (const { sources, providerIds } of customSources.values()) {
    // When scoped to a single provider, only refresh the registry group it
    // belongs to and only apply the target entry (siblings under the same URL
    // are left untouched).
    if (targetId !== undefined && !providerIds.includes(targetId)) continue;
    try {
      const { entries, source } = await fetchCustomRegistryFromSources(sources);
      // Build the whole batch on one clone so that several changed providers
      // from the same source do not overwrite each other's aliases, and so the
      // config we compare is exactly the config we persist.
      const next = structuredClone(config);
      const changedProviders: Array<{
        readonly providerId: string;
        readonly providerName: string;
        readonly added: number;
        readonly removed: number;
      }> = [];
      const providersToRemoveBeforeSet = new Set<string>();
      let hasUnreportedConfigChange = false;
      const remoteEntries = Object.values(entries);
      const remoteEntriesByProviderId = new Map(
        remoteEntries.map((entry) => [entry.id, entry]),
      );
      const providerIdsToSync = new Set(providerIds);
      // Only pull in newly-appeared providers from the registry when running an
      // unscoped refresh; a scoped refresh must not add siblings.
      if (targetId === undefined) {
        for (const entry of remoteEntries) providerIdsToSync.add(entry.id);
      }

      for (const providerId of providerIdsToSync) {
        if (targetId !== undefined && providerId !== targetId) continue;
        const entry = remoteEntriesByProviderId.get(providerId);
        if (entry === undefined) {
          const oldIds = collectModelIdsForAliases(config, providerAliasKeys(config, providerId));
          removeCustomRegistryProvider(next, providerId);
          changedProviders.push({
            providerId,
            providerName: providerId,
            added: 0,
            removed: oldIds.size,
          });
          providersToRemoveBeforeSet.add(providerId);
          continue;
        }

        const existed = config.providers[providerId] !== undefined;
        applyCustomRegistryProvider(next, entry, source);
        const refreshedAliasKeys = providerRefreshAliasKeys(config, next, providerId, `${providerId}/`);
        if (existed) {
          restoreProviderAliases(next, preserveUserProviderAliases(config, providerId, refreshedAliasKeys));
        }

        if (
          existed &&
          providerModelsEqual(config, next, providerId, refreshedAliasKeys) &&
          providerConfigEqual(config, next, providerId)
        ) {
          unchanged.push(providerId);
        } else if (existed && providerModelsEqual(config, next, providerId, refreshedAliasKeys)) {
          unchanged.push(providerId);
          providersToRemoveBeforeSet.add(providerId);
          hasUnreportedConfigChange = true;
        } else {
          const { added, removed } = computeChanges(
            collectModelIdsForAliases(config, refreshedAliasKeys),
            collectModelIdsForAliases(next, refreshedAliasKeys),
          );
          changedProviders.push({
            providerId,
            providerName: entry.name || providerId,
            added,
            removed,
          });
          if (existed) providersToRemoveBeforeSet.add(providerId);
        }
      }

      if (changedProviders.length > 0 || hasUnreportedConfigChange) {
        restoreDefaultSelection(next, config.defaultModel, config.defaultThinking);
        clampDanglingDefault(next);
        clearDefaultThinkingWhenDefaultRemoved(next, config.defaultModel);
        for (const providerId of providersToRemoveBeforeSet) {
          await host.removeProvider(providerId);
        }
        config = await host.setConfig({
          providers: next.providers,
          models: next.models,
          defaultModel: next.defaultModel,
          defaultThinking: next.defaultThinking,
        });
        for (const change of changedProviders) {
          changed.push({
            providerId: change.providerId,
            providerName: change.providerName,
            added: change.added,
            removed: change.removed,
          });
        }
      }
    } catch (error) {
      const reportedIds = targetId !== undefined ? [targetId] : providerIds;
      for (const providerId of reportedIds) {
        failed.push({
          provider: providerId,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return { changed, unchanged, failed };
}
