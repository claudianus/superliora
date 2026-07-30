import { TabbedModelSelectorComponent } from '../components/dialogs/tabbed-model-selector';
import { formatErrorMessage } from '../utils/event-payload';
import {
  resolveThinkingDisplay,
  resolveThinkingLevelForApply,
} from '#/tui/utils/thinking-effort';
import type { SlashCommandHost } from './dispatch';

export async function openModelPickerForProvider(
  host: SlashCommandHost,
  providerId: string,
): Promise<void> {
  const stateModels = await host.harness.getConfig().then((c) => c.models ?? {});

  const currentEffort =
    host.state.appState.thinkingLevel !== undefined &&
    host.state.appState.thinkingLevel !== 'off' &&
    host.state.appState.thinkingLevel !== 'on'
      ? host.state.appState.thinkingLevel
      : undefined;
  const selector = new TabbedModelSelectorComponent({
    models: stateModels,
    currentValue: host.state.appState.model,
    selectedValue: Object.keys(stateModels).find((a) => a.startsWith(`${providerId}/`)),
    currentThinking: host.state.appState.thinking,
    currentEffort,
    initialTabId: providerId,
    onSelect: ({ alias, thinking, effort }) => {
      host.restoreEditor();
      void setDefaultModel(host, alias, thinking, effort).catch((error: unknown) => {
        host.showError(`Set default model failed: ${formatErrorMessage(error)}`);
      });
    },
    onCancel: () => {
      host.restoreEditor();
    },
  });
  host.mountEditorReplacement(selector);
}

async function setDefaultModel(
  host: SlashCommandHost,
  alias: string,
  thinking: boolean,
  effort?: string,
): Promise<void> {
  await host.harness.setConfig({
    defaultModel: alias,
    defaultThinking: thinking,
  });
  await host.authFlow.refreshConfigAfterLogin();
  // refreshConfigAfterLogin may re-activate with only boolean thinking; apply
  // the selected effort (if any) to the live session so the footer/welcome
  // show the real level immediately after login model pick.
  const model = host.state.appState.availableModels[alias];
  const level = resolveThinkingLevelForApply(thinking, effort, model);
  const display = resolveThinkingDisplay(level, { thinking, model });
  if (host.session !== undefined && thinking && level !== 'off') {
    try {
      await host.session.setThinking(level);
    } catch {
      // Best-effort: default model is already saved; effort applies next turn
      // if the session rejects the intermediate setThinking.
    }
  }
  host.setAppState({ thinking, thinkingLevel: display.requested });
  host.track('model_switch', { model: alias });
  const levelLabel =
    display.label === 'off'
      ? 'off'
      : display.requested === display.effective
        ? display.requested
        : `${display.requested}→${display.effective}`;
  host.showStatus(`Default model set to ${alias} with thinking ${levelLabel}.`);
}
