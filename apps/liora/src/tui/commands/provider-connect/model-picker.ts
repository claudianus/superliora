import { TabbedModelSelectorComponent } from '../../components/dialogs/picker/tabbed-model-selector';
import { CustomModelInputDialogComponent } from '../../components/dialogs/provider/custom-model-input';
import { formatErrorMessage } from '../../utils/event-payload';
import { ttui } from '../../utils/tui-i18n';
import {
  resolveThinkingDisplay,
  resolveThinkingLevelForApply,
} from '#/tui/utils/model/thinking-effort';
import type { SlashCommandHost } from '../hub/dispatch';

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
  const mountPicker = (): void => {
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
          host.showError(ttui('tui.provider.modelSetFailed', { message: formatErrorMessage(error) }));
        });
      },
      onCustomModel: () => {
        host.restoreEditor();
        void promptCustomModelForProvider(host, providerId).then(() => mountPicker());
      },
      onCancel: () => {
        host.restoreEditor();
      },
    });
    host.mountEditorReplacement(selector);
  };
  mountPicker();
}

async function promptCustomModelForProvider(host: SlashCommandHost, providerId: string): Promise<void> {
  const config = await host.harness.getConfig();
  let catalogPromise: Promise<import('@superliora/sdk').Catalog | undefined> | undefined;
  try {
    const { loadCatalog } = await import('#/utils/catalog-cache');
    catalogPromise = loadCatalog().catch(() => undefined);
  } catch {
    catalogPromise = undefined;
  }
  const providerIds = Object.keys(config.providers);
  await new Promise<void>((resolve) => {
    const dialog = new CustomModelInputDialogComponent(
      (result) => {
        host.restoreEditor();
        resolve();
        if (result.kind !== 'ok') return;
        const { providerId: pid, modelId, displayName, maxContextSize, thinking, supportEfforts } = result.value;
        void (async () => {
          try {
            const cfg = await host.harness.getConfig();
            const prov = cfg.providers[pid];
            if (prov === undefined) throw new Error(`Provider "${pid}" not found.`);
            const alias = `${pid}/${modelId}`;
            const caps = thinking ? ['thinking', 'tool_use'] : ['tool_use'];
            cfg.models = {
              ...cfg.models,
              [alias]: {
                ...cfg.models?.[alias],
                provider: pid,
                model: modelId,
                maxContextSize,
                capabilities: caps,
                displayName: displayName ?? modelId,
                userManaged: true,
                ...(supportEfforts !== undefined && supportEfforts.length > 0 ? { supportEfforts: [...supportEfforts] } : {}),
              },
            };
            await host.harness.setConfig({ providers: cfg.providers, models: cfg.models });
            await host.authFlow.refreshConfigAfterLogin();
            await setDefaultModel(host, alias, thinking);
          } catch (error) {
            host.showError(`Failed to add custom model: ${formatErrorMessage(error)}`);
          }
        })();
      },
      { initialProviderId: providerId, catalogPromise, availableProviders: providerIds },
    );
    host.mountEditorReplacement(dialog);
  });
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
    thinking: {
      mode: thinking ? 'on' : 'off',
      ...(thinking && effort !== undefined && effort !== 'on' && effort !== 'off'
        ? { effort }
        : {}),
    },
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
  host.showStatus(ttui('tui.provider.defaultModelSet', { alias, level: levelLabel }));
}
