/**
 * Model-related slash command handlers and pickers extracted from config.ts.
 *
 * Covers: /model command, model routing (loop roles), fallback chain editor,
 * and the tabbed model picker with thinking-level selection.
 */

import {
  SMART_AUTO_SESSION_ALIAS,
  type DeleteConfigFieldPath,
  type ModelAlias,
} from '@superliora/sdk';

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
import { ttui } from '../../../utils/tui-i18n';

const MODEL_PICKER_REFRESH_TIMEOUT_MS = 2_000;

const MODEL_SETTINGS_RESET_PATHS: readonly DeleteConfigFieldPath[] = [
  'defaultProvider',
  'defaultModel',
  'defaultThinking',
  'thinking.mode',
  'thinking.effort',
  'loopControl.compactionModel',
  'loopControl.completionModel',
  'loopControl.explorationModel',
  'loopControl.codingModel',
  'loopControl.planningModel',
  'loopControl.debuggingModel',
];

export async function handleModelCommand(host: SlashCommandHost, args: string): Promise<void> {
  const alias = args.trim();
  await refreshModelsForPicker(host);
  if (alias.length === 0) {
    showModelPicker(host);
    return;
  }
  const isSmartAuto = alias.trim().toLowerCase() === SMART_AUTO_SESSION_ALIAS;
  if (!isSmartAuto && host.state.appState.availableModels[alias] === undefined) {
    host.showError(ttui('tui.model.unknownAlias', { alias }));
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
    host.showError(ttui('tui.model.routingLoadFailed', { message: formatErrorMessage(error) }));
  }
}

function mountLoopModelRoutingPicker(host: SlashCommandHost, config: LoopModelRoutingConfig): void {
  const rows = loopModelRoutingRows(
    config,
    host.state.appState.availableModels,
    host.state.appState.availableProviders,
  );
  const autoRoutingValue = '__smart_auto__';
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Model routing',
      hint: '↑↓ navigate · Enter select · Esc cancel',
      notice: 'Overrides apply on next worker spawn / role resolution. Unset roles use smart auto.',
      noticeTone: 'warning',
      options: [
        {
          value: autoRoutingValue,
          label: 'Smart auto routing',
          description:
            'Clear role overrides, live-probe each role chain, and pin only models that respond.',
        },
        ...rows.map((row) => ({
          value: row.key,
          label: row.label,
          description: `${row.state} — ${row.description}`,
        })),
      ],
      onSelect: (value) => {
        if (value === autoRoutingValue) {
          dismissPickerDialog(host);
          void resetAllLoopModelRouting(host);
          return;
        }
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

async function resetAllLoopModelRouting(host: SlashCommandHost): Promise<void> {
  // Smart auto: live-probe each role chain, clear stale overrides, pin survivors only.
  const spinner = host.showProgressSpinner(ttui('tui.model.smartAutoProbing'));

  let plan: Awaited<ReturnType<typeof host.harness.planSmartLoopRoleRouting>>;
  try {
    plan = await host.harness.planSmartLoopRoleRouting({
      onProgress: (progress) => {
        spinner.setLabel(formatSmartAutoProbeProgress(progress));
      },
    });
  } catch (error) {
    spinner.stop({
      ok: false,
      label: ttui('tui.model.smartAutoFailed', { message: formatErrorMessage(error) }),
    });
    return;
  }

  try {
    // Always clear every role key first so exhausted prior pins cannot linger.
    if (plan.clearPaths.length > 0) {
      await host.harness.deleteConfigFields([...plan.clearPaths]);
    }
    let config: LoopModelRoutingConfig;
    if (Object.keys(plan.patch.loopControl).length > 0) {
      config = (await host.harness.setConfig(plan.patch)) as LoopModelRoutingConfig;
    } else {
      config = (await host.harness.getConfig({ reload: true })) as LoopModelRoutingConfig;
    }

    if (plan.pins.length === 0) {
      spinner.stop({ ok: false, label: ttui('tui.model.smartAutoNoHealthy') });
    } else if (plan.skipped.length > 0) {
      const skippedLabels = plan.skipped.map((s) => s.label).join(', ');
      spinner.stop({
        ok: true,
        label: ttui('tui.model.smartAutoPartial', {
          pinned: String(plan.pins.length),
          skipped: skippedLabels,
        }),
      });
    } else {
      spinner.stop({
        ok: true,
        label: ttui('tui.model.smartAutoPinned', { count: String(plan.pins.length) }),
      });
    }
    mountLoopModelRoutingPicker(host, config);
  } catch (error) {
    spinner.stop({
      ok: false,
      label: ttui('tui.model.smartAutoFailed', { message: formatErrorMessage(error) }),
    });
  }
}

function formatSmartAutoProbeProgress(progress: {
  readonly label: string;
  readonly index: number;
  readonly total: number;
  readonly alias?: string;
  readonly chainIndex?: number;
  readonly chainTotal?: number;
}): string {
  const current = String(progress.index);
  const total = String(progress.total);
  if (
    progress.alias !== undefined &&
    progress.chainIndex !== undefined &&
    progress.chainTotal !== undefined
  ) {
    return ttui('tui.model.smartAutoProbingAlias', {
      role: progress.label,
      current,
      total,
      alias: progress.alias,
      chain: String(progress.chainIndex),
      chainTotal: String(progress.chainTotal),
    });
  }
  return ttui('tui.model.smartAutoProbingRole', {
    role: progress.label,
    current,
    total,
  });
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
      notice: `${role.label}: applies on next worker spawn / role resolution.`,
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
    host.showError(ttui('tui.model.roleRoutingFailed', { role: role.label, message: formatErrorMessage(error) }));
    return;
  }

  let config: LoopModelRoutingConfig;
  try {
    config = (await host.harness.getConfig({ reload: true })) as LoopModelRoutingConfig;
  } catch (error) {
    host.showError(
      ttui('tui.model.routingReloadFailed', { role: role.label, message: formatErrorMessage(error) }),
    );
    return;
  }

  host.showStatus(
    ttui('tui.model.routingSet', { role: role.label, alias }),
    'success',
  );
  mountLoopModelRoutingPicker(host, config);
}

export async function resetLoopModelRoutingChoice(
  host: SlashCommandHost,
  role: LoopModelRoutingRole & { readonly model?: string },
): Promise<void> {
  if (role.model === undefined) {
    host.showStatus(ttui('tui.model.roleRoutingAuto', { role: role.label }));
    void showLoopModelRoutingPicker(host);
    return;
  }

  let config: LoopModelRoutingConfig;
  try {
    config = (await host.harness.deleteConfigFields([
      loopModelRoutingDeletePath(role),
    ])) as LoopModelRoutingConfig;
  } catch (error) {
    host.showError(ttui('tui.model.roleResetFailed', { role: role.label, message: formatErrorMessage(error) }));
    return;
  }

  host.showStatus(
    ttui('tui.model.routingReset', { role: role.label }),
    'success',
  );
  mountLoopModelRoutingPicker(host, config);
}

export function showModelSettingsReset(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Reset model settings',
      hint: '↑↓ navigate · Enter select · Esc cancel',
      notice: 'Provider credentials and discovered model catalog are kept.',
      noticeTone: 'warning',
      options: [
        {
          value: 'reset',
          label: 'Reset all model settings',
          description:
            'Restore model defaults, thinking, role routing, and fallback chains to automatic behavior.',
          tone: 'danger',
        },
        {
          value: 'cancel',
          label: 'Cancel',
          description: 'Keep the current model configuration.',
        },
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value !== 'reset') return;
        void resetModelSettings(host);
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Reset model settings' },
  );
}

async function resetModelSettings(host: SlashCommandHost): Promise<void> {
  try {
    const config = await host.harness.getConfig({ reload: true });
    const fallbackModels = Object.fromEntries(
      Object.entries(config.models ?? {})
        .filter(([, model]) => (model.fallbackModels?.length ?? 0) > 0)
        .map(([alias]) => [alias, { fallbackModels: [] }]),
    );
    if (Object.keys(fallbackModels).length > 0) {
      await host.harness.setConfig({ models: fallbackModels });
    }
    await host.harness.deleteConfigFields(MODEL_SETTINGS_RESET_PATHS);
  } catch (error) {
    host.showError(ttui('tui.model.resetFailed', { message: formatErrorMessage(error) }));
    return;
  }

  host.showStatus(
    ttui('tui.model.settingsReset'),
    'success',
  );
}

export async function showModelFallbackPicker(host: SlashCommandHost): Promise<void> {
  const primaryAlias = host.state.appState.model;
  if (!primaryAlias) {
    host.showNotice(ttui('tui.model.noSelected'), ttui('tui.model.noSelectedDetail'));
    return;
  }

  const primaryModel = host.state.appState.availableModels[primaryAlias];
  if (!primaryModel) {
    host.showError(ttui('tui.model.notFound', { alias: primaryAlias }));
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
    host.showError(ttui('tui.model.fallbackLoadFailed', { message: formatErrorMessage(error) }));
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
    host.showNotice(ttui('tui.model.noneAvailable'), ttui('tui.model.noneAvailableDetail'));
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
        ? ttui('tui.model.fallbackUpdated', { count: String(fallbacks.length) })
        : ttui('tui.model.fallbackCleared'),
      'success',
    );
  } catch (error) {
    host.showError(ttui('tui.model.fallbackSaveFailed', { message: formatErrorMessage(error) }));
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
  const modelsWithSmartAuto: Record<string, ModelAlias> = {
    [SMART_AUTO_SESSION_ALIAS]: {
      model: SMART_AUTO_SESSION_ALIAS,
      provider: 'smart-auto',
      displayName: 'Smart Auto',
      maxContextSize: 1_000_000,
    },
    ...host.state.appState.availableModels,
  };
  const currentEffort =
    host.state.appState.thinkingLevel !== undefined &&
    host.state.appState.thinkingLevel !== 'off' &&
    host.state.appState.thinkingLevel !== 'on'
      ? host.state.appState.thinkingLevel
      : undefined;
  mountPickerDialog(
    host,
    new TabbedModelSelectorComponent({
      models: modelsWithSmartAuto,
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
    host.showError(ttui('tui.model.cannotSwitchStreaming'));
    return;
  }

  const isSmartAuto = alias.trim().toLowerCase() === SMART_AUTO_SESSION_ALIAS;
  const model = isSmartAuto ? undefined : host.state.appState.availableModels[alias];
  if (!isSmartAuto && model === undefined) {
    host.showError(ttui('tui.model.unknownAlias', { alias }));
    return;
  }
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
    host.showError(ttui('tui.model.switchFailed', { message: msg }));
    return;
  }

  host.setAppState({
    model: alias,
    thinking,
    thinkingLevel: display.requested,
    ...(isSmartAuto
      ? {
          lastModelRouteNotice: {
            kind: 'selection' as const,
            toAlias: SMART_AUTO_SESSION_ALIAS,
            reason: 'smart-auto pin',
            atMs: Date.now(),
          },
        }
      : {}),
  });
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
      persisted = await persistModelSelection(host, alias, thinking, effort);
    } catch (error) {
      const msg = formatErrorMessage(error);
      host.showError(ttui('tui.model.switchedSaveFailed', { alias, message: msg }));
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
      ? ttui('tui.model.switched', { alias, level: levelLabel })
      : ttui('tui.model.switchedSessionOnly', { alias, level: levelLabel });
  } else if (persist && persisted) {
    status = ttui('tui.model.savedDefault', { alias, level: levelLabel });
  } else {
    status = ttui('tui.model.alreadyUsing', { alias, level: levelLabel });
  }
  host.showStatus(status, 'success');
}

async function persistModelSelection(
  host: SlashCommandHost,
  alias: string,
  thinking: boolean,
  effort?: string,
): Promise<boolean> {
  const config = await host.harness.getConfig({ reload: true });
  const persistedEffort =
    thinking && effort !== undefined && effort !== 'on' && effort !== 'off'
      ? effort
      : config.thinking?.effort;
  if (
    config.defaultModel === alias &&
    config.defaultThinking === thinking &&
    config.thinking?.mode === (thinking ? 'on' : 'off') &&
    config.thinking?.effort === persistedEffort
  ) {
    return false;
  }
  await host.harness.setConfig({
    defaultModel: alias,
    defaultThinking: thinking,
    thinking: {
      mode: thinking ? 'on' : 'off',
      ...(persistedEffort !== undefined ? { effort: persistedEffort } : {}),
    },
  });
  return true;
}
