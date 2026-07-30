import { setExperimentalFeatures } from '../commands';
import * as slashCommands from '../commands/dispatch';
import { DEFAULT_ONBOARDING_PREFERENCES } from '../config';
import type { StartupLifecycleHost } from './startup-lifecycle-types';

export async function maybeStartOnboarding(host: StartupLifecycleHost): Promise<void> {
  const config = await host.harness.getConfig({ reload: true });
  const hasProvider =
    config.defaultModel !== undefined ||
    Object.keys(config.providers ?? {}).length > 0;
  if (!hasProvider) {
    const qwenKey = process.env['QWEN_TOKEN_PLAN_API_KEY']?.trim();
    if (qwenKey !== undefined && qwenKey.length > 0) {
      const { applyQwenTokenPlanProvider } = await import('#/tui/utils/qwen-token-plan');
      applyQwenTokenPlanProvider(config, qwenKey);
      await host.harness.setConfig({
        providers: config.providers,
        models: config.models,
        defaultModel: config.defaultModel,
        defaultThinking: config.defaultThinking,
      });
      await host.authFlow.refreshConfigAfterLogin();
      host.showStatus(
        'Qwen Cloud (Token Plan) auto-configured from QWEN_TOKEN_PLAN_API_KEY. ' +
          'Text, image, and video generation enabled; harness tools run server-side on qwen3.7/3.8 models.',
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
      host.showStatus(`Skipped refreshing ${f.provider}: ${f.reason}`, 'warning');
    }
  } catch {
    // Best-effort: startup must not crash on background refresh failures.
  }
}

export async function prepareStartupExperimentalFeatures(host: StartupLifecycleHost): Promise<void> {
  setExperimentalFeatures(await host.harness.getExperimentalFeatures(), true);
  await host.authFlow.refreshAvailableModels();
}
