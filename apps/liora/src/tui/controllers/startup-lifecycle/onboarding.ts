import { formatBytes, LIORA_HOME_COMFORT_FREE_BYTES, probeVolumeSpace } from '@superliora/sdk';

import { detectedConnectEnvHints } from '#/utils/local-catalog-providers';
import { getDataDir } from '#/utils/paths';

import { setExperimentalFeatures } from '../../commands';
import * as slashCommands from '../../commands/hub/dispatch';
import { ttui } from '../../utils/tui-i18n';
import { formatModelRefreshFailureNotice } from '../../utils/session/model-refresh-notice';
import type { StartupLifecycleHost } from './types';

export async function maybeWarnTightDataHome(host: StartupLifecycleHost): Promise<void> {
  try {
    const homeDir = host.harness.homeDir ?? getDataDir();
    const volume = await probeVolumeSpace(homeDir);
    if (volume === undefined || volume.freeBytes >= LIORA_HOME_COMFORT_FREE_BYTES) return;
    host.showNotice(
      ttui('tui.settings.pane.storage.title'),
      ttui('tui.storage.homeTight', { free: formatBytes(volume.freeBytes) }),
      { coalesceKey: 'storage.homeTight' },
    );
    host.showStatus(
      ttui('tui.storage.homeTight', { free: formatBytes(volume.freeBytes) }),
      'warning',
    );
  } catch {
    // Probe failure must not block startup.
  }
}

export async function maybeStartOnboarding(host: StartupLifecycleHost): Promise<void> {
  const config = await host.harness.getConfig({ reload: true });
  const hasProvider =
    config.defaultModel !== undefined ||
    Object.keys(config.providers ?? {}).length > 0;
  if (!hasProvider) {
    const tokenPlanKey =
      process.env['QWEN_TOKEN_PLAN_API_KEY']?.trim() ||
      process.env['ALIBABA_TOKEN_PLAN_API_KEY']?.trim();
    if (tokenPlanKey !== undefined && tokenPlanKey.length > 0) {
      const { applyQwenTokenPlanProvider, tokenPlanTextModelsFromCatalog } = await import(
        '#/tui/utils/model/qwen-token-plan'
      );
      // Resolve the live model list from models.dev when reachable; the
      // apply step falls back to built-in presets when this returns
      // `undefined` (offline or catalog unavailable).
      let liveModels: ReturnType<typeof tokenPlanTextModelsFromCatalog>;
      try {
        const { loadCatalog } = await import('#/utils/catalog-cache');
        liveModels = tokenPlanTextModelsFromCatalog(await loadCatalog());
      } catch {
        liveModels = undefined;
      }
      applyQwenTokenPlanProvider(
        config,
        tokenPlanKey,
        liveModels === undefined ? {} : { models: liveModels },
      );
      await host.harness.setConfig({
        providers: config.providers,
        models: config.models,
        defaultModel: config.defaultModel,
        defaultThinking: config.defaultThinking,
      });
      await host.authFlow.refreshConfigAfterLogin();
      host.showStatus(
        'Alibaba Token Plan (Qwen Cloud) auto-configured from the Token Plan API key. ' +
          'Text, image, and video generation enabled; harness tools run server-side on supported models.',
        'success',
      );
    } else {
      const hints = detectedConnectEnvHints();
      if (hints.length > 0) {
        const labels = hints.map((h) => h.label).join(', ');
        const vars = hints.map((h) => h.env).join(', ');
        host.showNotice(
          ttui('tui.onboarding.envKeyHintTitle'),
          ttui('tui.onboarding.envKeyHint', { labels, vars }),
          { coalesceKey: 'onboarding.envKeyHint' },
        );
        host.showStatus(ttui('tui.onboarding.envKeyHintStatus', { labels }), 'info');
      }
      slashCommands.dispatchInput(host as never, '/login');
      return;
    }
  }
}

export async function refreshProviderModelsInBackground(
  host: StartupLifecycleHost,
): Promise<void> {
  try {
    const result = await host.authFlow.refreshProviderModels();
    for (const c of result.changed) {
      if (c.added <= 0) continue;
      host.showStatus(ttui('tui.onboarding.modelsAdded', { provider: c.providerName, count: String(c.added), plural: c.added > 1 ? 's' : '' }));
    }
    for (const f of result.failed) {
      // Loop54a: named notice — status alone was easy to miss under splash.
      const notice = formatModelRefreshFailureNotice(f);
      host.showNotice(notice.title, notice.detail, {
        coalesceKey: notice.coalesceKey,
      });
      host.showStatus(notice.status, 'warning');
    }
  } catch {
    // Best-effort: startup must not crash on background refresh failures.
  }
  // Best-effort prune of stale free aliases that are no longer in live catalog.
  void pruneStaleFreeModelsInBackground(host);
}

async function pruneStaleFreeModelsInBackground(host: StartupLifecycleHost): Promise<void> {
  try {
    const { loadCatalog } = await import('#/utils/catalog-cache');
    const catalog = await loadCatalog().catch(() => undefined);
    if (catalog === undefined) return;
    const { getStaleFreeAliasDeletePaths } = await import('#/utils/migrate-stale-free-models');
    const config = await host.harness.getConfig({ reload: true });
    const pruned = getStaleFreeAliasDeletePaths(config, catalog);
    if (pruned === undefined || pruned.deletePaths.length === 0) return;
    await host.harness.deleteConfigFields([...pruned.deletePaths]);
    if (pruned.clearDefaultModel) {
      // Session model was already auto; ensure it stays auto.
      try { await host.session?.setModel('auto'); } catch {}
    }
  } catch {
    // best-effort
  }
}

export async function prepareStartupExperimentalFeatures(host: StartupLifecycleHost): Promise<void> {
  setExperimentalFeatures(await host.harness.getExperimentalFeatures(), true);
  await host.authFlow.refreshAvailableModels();
}
