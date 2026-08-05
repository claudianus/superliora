import { setExperimentalFeatures } from '../../commands';
import * as slashCommands from '../../commands/hub/dispatch';
import { DEFAULT_ONBOARDING_PREFERENCES } from '../../config';
import { formatModelRefreshFailureNotice } from '../../utils/session/model-refresh-notice';
import type { StartupLifecycleHost } from './types';

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
      slashCommands.dispatchInput(host as never, '/login');
      return;
    }
  }

  const onboarding = host.state.appState.onboarding ?? DEFAULT_ONBOARDING_PREFERENCES;
  const editorBusy = (host.state.editor.getText?.() ?? '').trim().length > 0;
  if (!onboarding.hubIntroSeen && !editorBusy) {
    host.showCommandHub({ intro: true });
  }
}

export async function refreshProviderModelsInBackground(
  host: StartupLifecycleHost,
): Promise<void> {
  try {
    const result = await host.authFlow.refreshProviderModels();
    for (const c of result.changed) {
      if (c.added <= 0) continue;
      host.showStatus(`${c.providerName} · +${String(c.added)} model${c.added > 1 ? 's' : ''}.`);
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
}

export async function prepareStartupExperimentalFeatures(host: StartupLifecycleHost): Promise<void> {
  setExperimentalFeatures(await host.harness.getExperimentalFeatures(), true);
  await host.authFlow.refreshAvailableModels();
}
