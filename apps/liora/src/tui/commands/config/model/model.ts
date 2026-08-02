/**
 * Model-related slash command handlers and pickers extracted from config.ts.
 *
 * Covers: /model command, model routing (loop roles), fallback chain editor,
 * and the tabbed model picker with thinking-level selection.
 */

import type { ModelAlias } from '@superliora/sdk';

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { ModelFallbackSelectorComponent, type ModelFallbackAction, type ModelFallbackItem } from '../../../components/dialogs/picker/model-fallback-selector';
import { TabbedModelSelectorComponent } from '../../../components/dialogs/picker/tabbed-model-selector';
import { formatErrorMessage } from '../../../utils/event-payload';
import {
  formatModelRefreshErrorNotice,
  formatModelRefreshFailureNotice,
} from '../../../utils/session/model-refresh-notice';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';
import {
  resolveThinkingDisplay,
  resolveThinkingLevelForApply,
} from '#/tui/utils/model/thinking-effort';
import {
  loopModelRoutingDeletePath,
  loopModelRoutingPatch,
  loopModelRoutingRows,
  type LoopModelRoutingConfig,
  type LoopModelRoutingRole,
} from '#/tui/utils/model/loop-model-routing';
import {
  getFallbackModels,
  fallbackModelsPatch,
  clearFallbackModelsPatch,
  type ModelFallbackConfig,
} from '#/tui/utils/model/model-fallback';
import type { SlashCommandHost } from '../../hub/dispatch';

const MODEL_PICKER_REFRESH_TIMEOUT_MS = 2_000;

export async function handleModelCommand(host: SlashCommandHost, args: string): Promise<void> {
  const alias = args.trim();
  await refreshModelsForPicker(host);
  if (alias.length === 0) {
    showModelPicker(host);
    return;
  }
  if (host.state.appState.availableModels[alias] === undefined) {
    host.showError(`Unknown model alias: ${alias}`);
    return;
  }
  showModelPicker(host, alias);
}

async function refreshModelsForPicker(host: SlashCommandHost): Promise<void> {
  try {
    const result = await withTimeout(
      host.authFlow.refreshOAuthProviderModels(),
      MODEL_PICKER_REFRESH_TIMEOUT_MS,
    );
    if (result === undefined) return;
    for (const f of result.failed) {
      // Loop54a: named notice for per-provider catalog failures.
      const notice = formatModelRefreshFailureNotice(f);
      host.showNotice?.(notice.title, notice.detail, {
        coalesceKey: notice.coalesceKey,
      });
      host.showStatus(notice.status, 'warning');
    }
  } catch (error) {
    const notice = formatModelRefreshErrorNotice(formatErrorMessage(error));
    host.showNotice?.(notice.title, notice.detail, {
      coalesceKey: notice.coalesceKey,
    });
    host.showStatus(notice.status, 'warning');
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timeout = setTimeout(() => {
          resolve(undefined);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export async function showLoopModelRoutingPicker(host: SlashCommandHost): Promise<void> {
  try {
    const config = await host.harness.getConfig({ reload: true });
    mountLoopModelRoutingPicker(host, config as LoopModelRoutingConfig);
  } catch (error) {
    host.showError(`Failed to load model routing: ${formatErrorMessage(error)}`);
  }
}

function mountLoopModelRoutingPicker(host: SlashCommandHost, config: LoopModelRoutingConfig): void {
  const rows = loopModelRoutingRows(config);
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Model routing',
      hint: '↑↓ navigate · Enter select · Esc cancel',
      notice: 'Overrides apply to future resolution; the current session is unchanged.',
      noticeTone: 'warning',
      options: rows.map((row) => ({
        value: row.key,
        label: row.label,
        description: row.model === undefined
          ? 'default (no explicit override)'
          : `override · ${row.model}`,
      })),
      onSelect: (value) => {
        const row = rows.find((candidate) => candidate.key === value);
        if (row === undefined) return;
        dismissPickerDialog(host);
        showLoopRoleModelPicker(host, row);
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Model routing' },
  );
}

function showLoopRoleModelPicker(host: SlashCommandHost, role: LoopModelRoutingRole & { readonly model?: string }): void {
  if (Object.keys(host.state.appState.availableModels).length === 0) {
    host.showNotice(
      'No models configured',
      'Run /login to sign in or add a provider, then choose a routing override.',
    );
    return;
  }

  mountPickerDialog(
    host,
    new TabbedModelSelectorComponent({
      models: host.state.appState.availableModels,
      currentValue: role.model ?? '',
      selectedValue: role.model,
      currentThinking: false,
      onSelect: ({ alias }) => {
        dismissPickerDialog(host);
        void applyLoopModelRoutingChoice(host, role, alias);
      },
      onReset: () => {
        dismissPickerDialog(host);
        void resetLoopModelRoutingChoice(host, role);
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
      notice: `${role.label} override · applies to future resolution only.`,
    }),
    { label: `${role.label} model routing` },
  );
}

export async function applyLoopModelRoutingChoice(
  host: SlashCommandHost,
  role: LoopModelRoutingRole,
  alias: string,
): Promise<void> {
  try {
    await host.harness.setConfig(loopModelRoutingPatch(role, alias));
  } catch (error) {
    host.showError(`Failed to set ${role.label} routing override: ${formatErrorMessage(error)}`);
    return;
  }

  let config: LoopModelRoutingConfig;
  try {
    config = (await host.harness.getConfig({ reload: true })) as LoopModelRoutingConfig;
  } catch (error) {
    host.showError(
      `Saved ${role.label} routing override, but failed to reload it: ${formatErrorMessage(error)}`,
    );
    return;
  }

  host.showStatus(
    `${role.label} routing override set to ${alias}. Future resolution will use it; the current session is unchanged.`,
    'success',
  );
  mountLoopModelRoutingPicker(host, config);
}

export async function resetLoopModelRoutingChoice(
  host: SlashCommandHost,
  role: LoopModelRoutingRole & { readonly model?: string },
): Promise<void> {
  if (role.model === undefined) {
    host.showStatus(`${role.label} routing already uses the default.`);
    void showLoopModelRoutingPicker(host);
    return;
  }

  let config: LoopModelRoutingConfig;
  try {
    config = (await host.harness.deleteConfigFields([
      loopModelRoutingDeletePath(role),
    ])) as LoopModelRoutingConfig;
  } catch (error) {
    host.showError(`Failed to reset ${role.label} routing override: ${formatErrorMessage(error)}`);
    return;
  }

  host.showStatus(
    `${role.label} routing reset to default. Future resolution will use the default; the current session is unchanged.`,
    'success',
  );
  mountLoopModelRoutingPicker(host, config);
}

export async function showModelFallbackPicker(host: SlashCommandHost): Promise<void> {
  const primaryAlias = host.state.appState.model;
  if (!primaryAlias) {
    host.showNotice('No model selected', 'Select a model first with /model.');
    return;
  }

  const primaryModel = host.state.appState.availableModels[primaryAlias];
  if (!primaryModel) {
    host.showError(`Model "${primaryAlias}" not found.`);
    return;
  }

  try {
    const config = (await host.harness.getConfig({ reload: true })) as ModelFallbackConfig;
    const fallbacks = getFallbackModels(config, primaryAlias);
    const fallbackItems: ModelFallbackItem[] = fallbacks.map((alias) => {
      const model = host.state.appState.availableModels[alias];
      return {
        alias,
        displayName: model?.displayName ?? alias,
        provider: model?.provider ?? 'unknown',
      };
    });

    mountFallbackEditor(host, primaryAlias, primaryModel.displayName ?? primaryAlias, fallbackItems);
  } catch (error) {
    host.showError(`Failed to load fallback config: ${formatErrorMessage(error)}`);
  }
}

function mountFallbackEditor(
  host: SlashCommandHost,
  primaryAlias: string,
  primaryDisplayName: string,
  fallbackItems: ModelFallbackItem[],
): void {
  mountPickerDialog(
    host,
    new ModelFallbackSelectorComponent({
      primaryModel: primaryAlias,
      primaryDisplayName,
      fallbacks: fallbackItems,
      onSelect: (action: ModelFallbackAction) => {
        void handleFallbackAction(host, primaryAlias, fallbackItems, action);
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Model fallback' },
  );
}

async function handleFallbackAction(
  host: SlashCommandHost,
  primaryAlias: string,
  fallbackItems: ModelFallbackItem[],
  action: ModelFallbackAction,
): Promise<void> {
  const currentFallbacks = fallbackItems.map((item) => item.alias);

  switch (action.type) {
    case 'edit': {
      const currentAlias = fallbackItems[action.index]?.alias;
      showFallbackModelPicker(host, primaryAlias, currentFallbacks, (newAlias) => {
        const updated = [...currentFallbacks];
        updated[action.index] = newAlias;
        void saveFallbacksAndRefresh(host, primaryAlias, updated);
      });
      break;
    }

    case 'add': {
      showFallbackModelPicker(host, primaryAlias, currentFallbacks, (newAlias) => {
        const updated = [...currentFallbacks, newAlias];
        void saveFallbacksAndRefresh(host, primaryAlias, updated);
      });
      break;
    }

    case 'remove': {
      const updated = currentFallbacks.filter((_, i) => i !== action.index);
      await saveFallbacksAndRefresh(host, primaryAlias, updated);
      break;
    }

    case 'moveUp': {
      if (action.index > 0) {
        const updated = [...currentFallbacks];
        const temp = updated[action.index - 1];
        updated[action.index - 1] = updated[action.index]!;
        updated[action.index] = temp!;
        await saveFallbacksAndRefresh(host, primaryAlias, updated);
      }
      break;
    }

    case 'moveDown': {
      if (action.index < currentFallbacks.length - 1) {
        const updated = [...currentFallbacks];
        const temp = updated[action.index];
        updated[action.index] = updated[action.index + 1]!;
        updated[action.index + 1] = temp!;
        await saveFallbacksAndRefresh(host, primaryAlias, updated);
      }
      break;
    }

    case 'clear': {
      await saveFallbacksAndRefresh(host, primaryAlias, []);
      break;
    }
  }
}

function showFallbackModelPicker(
  host: SlashCommandHost,
  primaryAlias: string,
  currentFallbacks: readonly string[],
  onSelect: (alias: string) => void,
): void {
  const availableModels = Object.entries(host.state.appState.availableModels)
    .filter(([alias]) => alias !== primaryAlias && !currentFallbacks.includes(alias))
    .reduce<Record<string, ModelAlias>>((acc, [alias, model]) => {
      acc[alias] = model;
      return acc;
    }, {});

  if (Object.keys(availableModels).length === 0) {
    host.showNotice('No models available', 'All models are already in the fallback list or selected as primary.');
    return;
  }

  mountPickerDialog(
    host,
    new TabbedModelSelectorComponent({
      models: availableModels,
      currentValue: '',
      currentThinking: false,
      onSelect: ({ alias }) => {
        dismissPickerDialog(host);
        onSelect(alias);
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
      notice: 'Select a fallback model.',
    }),
    { label: 'Select fallback model' },
  );
}

async function saveFallbacksAndRefresh(
  host: SlashCommandHost,
  primaryAlias: string,
  fallbacks: readonly string[],
): Promise<void> {
  try {
    const patch = fallbacks.length > 0
      ? fallbackModelsPatch(primaryAlias, fallbacks)
      : clearFallbackModelsPatch(primaryAlias);

    await host.harness.setConfig(patch);

    const config = (await host.harness.getConfig({ reload: true })) as ModelFallbackConfig;
    const updatedFallbacks = getFallbackModels(config, primaryAlias);
    const updatedItems: ModelFallbackItem[] = updatedFallbacks.map((alias) => {
      const model = host.state.appState.availableModels[alias];
      return {
        alias,
        displayName: model?.displayName ?? alias,
        provider: model?.provider ?? 'unknown',
      };
    });

    const primaryModel = host.state.appState.availableModels[primaryAlias];
    mountFallbackEditor(host, primaryAlias, primaryModel?.displayName ?? primaryAlias, updatedItems);

    host.showStatus(
      fallbacks.length > 0
        ? `Fallback list updated (${fallbacks.length} model${fallbacks.length > 1 ? 's' : ''}).`
        : 'Fallback list cleared.',
      'success',
    );
  } catch (error) {
    host.showError(`Failed to save fallback config: ${formatErrorMessage(error)}`);
  }
}

export function showModelPicker(host: SlashCommandHost, selectedValue: string = host.state.appState.model): void {
  const entries = Object.entries(host.state.appState.availableModels);
  if (entries.length === 0) {
    host.showNotice(
      'No models configured',
      'Run /login to sign in or add a provider, then pick a model with /model.',
    );
    return;
  }
  const currentEffort =
    host.state.appState.thinkingLevel !== undefined &&
    host.state.appState.thinkingLevel !== 'off' &&
    host.state.appState.thinkingLevel !== 'on'
      ? host.state.appState.thinkingLevel
      : undefined;
  mountPickerDialog(
    host,
    new TabbedModelSelectorComponent({
      models: host.state.appState.availableModels,
      currentValue: host.state.appState.model,
      selectedValue,
      currentThinking: host.state.appState.thinking,
      currentEffort,
      onSelect: ({ alias, thinking, effort }) => {
        dismissPickerDialog(host);
        void performModelSwitch(host, alias, thinking, true, effort);
      },
      onSessionOnlySelect: ({ alias, thinking, effort }) => {
        dismissPickerDialog(host);
        void performModelSwitch(host, alias, thinking, false, effort);
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Model' },
  );
}

async function performModelSwitch(
  host: SlashCommandHost,
  alias: string,
  thinking: boolean,
  persist: boolean,
  effort?: string,
): Promise<void> {
  if (host.state.appState.streamingPhase !== 'idle') {
    host.showError('Cannot switch models while streaming — press Esc or Ctrl-C first.');
    return;
  }

  const model = host.state.appState.availableModels[alias];
  const level = resolveThinkingLevelForApply(thinking, effort, model);
  const display = resolveThinkingDisplay(level, { thinking, model });
  const prevModel = host.state.appState.model;
  const prevThinking = host.state.appState.thinking;
  const prevLevel = host.state.appState.thinkingLevel ?? (prevThinking ? 'on' : 'off');
  const runtimeChanged = alias !== prevModel || level !== prevLevel;

  const session = host.session;
  try {
    if (session === undefined && runtimeChanged) {
      await host.authFlow.activateModelAfterLogin(
        alias,
        thinking,
        level === 'off' ? undefined : level,
      );
    } else if (session !== undefined) {
      if (alias !== prevModel) {
        await session.setModel(alias);
      }
      if (level !== prevLevel || (alias !== prevModel && thinking)) {
        await session.setThinking(level);
      }
    }
  } catch (error) {
    const msg = formatErrorMessage(error);
    host.showError(`Failed to switch model: ${msg}`);
    return;
  }

  host.setAppState({ model: alias, thinking, thinkingLevel: display.requested });
  if (session === undefined && runtimeChanged) {
    if (alias !== prevModel) {
      host.track('model_switch', { model: alias });
    }
    if (level !== prevLevel) {
      host.track('thinking_toggle', { enabled: thinking, level: display.requested });
    }
  }

  let persisted = false;
  if (persist) {
    try {
      persisted = await persistModelSelection(host, alias, thinking);
    } catch (error) {
      const msg = formatErrorMessage(error);
      host.showError(`Switched to ${alias}, but failed to save default: ${msg}`);
      return;
    }
  }

  const levelLabel =
    display.label === 'off'
      ? 'off'
      : display.requested === display.effective
        ? display.requested
        : `${display.requested}→${display.effective}`;
  let status: string;
  if (runtimeChanged) {
    status = persist
      ? `Switched to ${alias} with thinking ${levelLabel}.`
      : `Switched to ${alias} with thinking ${levelLabel} for this session only.`;
  } else if (persist && persisted) {
    status = `Saved ${alias} with thinking ${levelLabel} as default.`;
  } else {
    status = `Already using ${alias} with thinking ${levelLabel}.`;
  }
  host.showStatus(status, 'success');
}

async function persistModelSelection(host: SlashCommandHost, alias: string, thinking: boolean): Promise<boolean> {
  const config = await host.harness.getConfig({ reload: true });
  if (config.defaultModel === alias && config.defaultThinking === thinking) {
    return false;
  }
  await host.harness.setConfig({
    defaultModel: alias,
    defaultThinking: thinking,
  });
  return true;
}
