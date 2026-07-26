import type {
  ExperimentalFeatureState,
  ModelAlias,
  PermissionMode,
  Session,
} from '@superliora/sdk';

import { ChoicePickerComponent } from '../components/dialogs/choice-picker';
import { ContextWorkingSetSelectorComponent } from '../components/dialogs/context-working-set-selector';
import { EditorSelectorComponent } from '../components/dialogs/editor-selector';
import {
  ExperimentsSelectorComponent,
  type ExperimentalFeatureDraftChange,
} from '../components/dialogs/experiments-selector';
import { TabbedModelSelectorComponent } from '../components/dialogs/tabbed-model-selector';
import { PermissionSelectorComponent } from '../components/dialogs/permission-selector';
import { SettingsSelectorComponent, type SettingsSelection } from '../components/dialogs/settings-selector';
import { ThemeSelectorComponent } from '../components/dialogs/theme-selector';
import { UpdatePreferenceSelectorComponent } from '../components/dialogs/update-preference-selector';
import {
  DEFAULT_APPEARANCE_PREFERENCES,
  saveTuiConfig,
  type AppearancePreferences,
  type TuiConfig,
} from '../config';
import type { ThemeName } from '#/tui/theme';
import { currentTheme, isBuiltInTheme, lightColors, loadCustomThemeMerged } from '#/tui/theme';
import { importThemeSource } from '#/tui/theme/importer';
import { LLM_NOT_SET_MESSAGE, NO_ACTIVE_SESSION_MESSAGE } from '../constant/liora-tui';
import { formatErrorMessage } from '../utils/event-payload';
import {
  contextWorkingSetPresetById,
  contextWorkingSetSnapshotFromLoopControl,
  formatTokenCount,
  loopControlPatchForPreset,
  matchContextWorkingSetPreset,
  previewContextWorkingSet,
  type ContextWorkingSetPresetId,
} from '#/tui/utils/context-working-set';
import {
  resolveThinkingDisplay,
  resolveThinkingLevelForApply,
} from '#/tui/utils/thinking-effort';
import { handleAccountsCommand } from './accounts';
import { showMcpServers, showUsage } from './info';
import { handlePremiumQualityCommand } from './premium';
import { handlePersonaCommand } from './persona';
import { setExperimentalFeatures } from './experimental-flags';
import type { SlashCommandHost } from './dispatch';
import { isActiveUltraworkRun, ultraworkModeDisableBlockedMessage } from './ultrawork-contract';
import { ttui } from '#/tui/utils/tui-i18n';

// ---------------------------------------------------------------------------
// Plan / Config commands
// ---------------------------------------------------------------------------

const MODEL_PICKER_REFRESH_TIMEOUT_MS = 2_000;
const THINKING_LEVELS = ['off', 'on', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
type ThinkingLevel = (typeof THINKING_LEVELS)[number];
const APPEARANCE_KEYS = [
  'profile',
  'density',
  'timestamps',
  'particles',
  'animation-fps',
  'canvas-background',
  'terminal-background',
  'terminal-palette',
] as const;

export async function handlePlanCommand(host: SlashCommandHost, args: string): Promise<void> {
  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }

  const subcmd = args.trim().toLowerCase();
  if (subcmd === 'clear') {
    await session.clearPlan();
    host.showNotice('Plan cleared');
    return;
  }

  let enabled: boolean;
  let ultra = false;
  if (subcmd.length === 0) enabled = !host.state.appState.planMode;
  else if (subcmd === 'on') enabled = true;
  else if (subcmd === 'off') enabled = false;
  else if (subcmd === 'ultra') {
    // Internal path for Shift+Tab shortcut; prefer /ultraplan for explicit use.
    enabled = true;
    ultra = true;
  }
  else {
    host.showError(`Unknown plan subcommand: ${subcmd}. Use on, off, or clear.`);
    return;
  }

  await applyPlanMode(host, session, enabled, ultra);
}

export async function handleThinkingCommand(host: SlashCommandHost, args: string): Promise<void> {
  const raw = args.trim();
  if (raw.length === 0) {
    host.showStatus(formatThinkingStatus(host));
    return;
  }

  const level = normalizeThinkingLevel(args);
  if (level === undefined) {
    host.showError(
      `Unknown thinking level: ${args.trim() || '(empty)'}. Use ${formatThinkingLevels()}.`,
    );
    return;
  }

  const modelAlias = host.state.appState.model.trim();
  if (modelAlias.length === 0) {
    host.showError(LLM_NOT_SET_MESSAGE);
    return;
  }

  const model = host.state.appState.availableModels[modelAlias];
  const validationError = validateThinkingLevelForModel(level, model);
  if (validationError !== undefined) {
    host.showError(validationError);
    return;
  }

  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }

  // Clamp onto the model support list before applying so UI and session match.
  const applied =
    level === 'off' || level === 'on'
      ? level
      : resolveThinkingLevelForApply(true, level, model);

  try {
    await session.setThinking(applied);
  } catch (error) {
    host.showError(`Failed to set thinking: ${formatErrorMessage(error)}`);
    return;
  }

  const enabled = applied !== 'off';
  // UI may show a clamp note (max→high) when the wire mapping differs.
  const display = resolveThinkingDisplay(applied, { thinking: enabled, model });
  host.setAppState({ thinking: enabled, thinkingLevel: display.requested });
  host.track('thinking_toggle', { enabled, level: display.requested });
  const statusLabel =
    display.label === 'off'
      ? 'off'
      : display.requested === display.effective
        ? display.requested
        : `${display.requested} (wire ${display.effective})`;
  host.showStatus(`Thinking set to ${statusLabel}.`, 'success');
}

function normalizeThinkingLevel(args: string): ThinkingLevel | undefined {
  const normalized = args.trim().toLowerCase();
  return THINKING_LEVELS.includes(normalized as ThinkingLevel)
    ? (normalized as ThinkingLevel)
    : undefined;
}

function validateThinkingLevelForModel(
  level: ThinkingLevel,
  model: ModelAlias | undefined,
): string | undefined {
  if (model === undefined) return undefined;
  const caps = model.capabilities ?? [];
  const alwaysThinking = caps.includes('always_thinking');
  const supportsThinking =
    alwaysThinking || caps.includes('thinking') || model.adaptiveThinking === true;

  if (level === 'off') {
    return alwaysThinking ? 'Current model requires thinking.' : undefined;
  }
  if (!supportsThinking) return 'Current model does not support thinking.';

  const supportEfforts = model.supportEfforts;
  if (supportEfforts !== undefined && level !== 'on') {
    const supported = new Set(supportEfforts.map((effort) => effort.trim().toLowerCase()));
    if (!supported.has(level)) {
      return `Current model supports thinking efforts: ${supportEfforts.join(', ')}.`;
    }
  }
  return undefined;
}

function formatThinkingLevels(): string {
  return THINKING_LEVELS.join(', ');
}

function formatThinkingStatus(host: SlashCommandHost): string {
  const modelAlias = host.state.appState.model.trim();
  const model = host.state.appState.availableModels[modelAlias];
  const display = resolveThinkingDisplay(
    host.state.appState.thinkingLevel ?? (host.state.appState.thinking ? 'on' : 'off'),
    { thinking: host.state.appState.thinking, model },
  );
  const levelLabel =
    display.label === 'off'
      ? 'off'
      : display.requested === display.effective
        ? display.requested
        : `${display.requested}→${display.effective}`;

  // Check if model supports thinking.
  const caps = model?.capabilities ?? [];
  const supportsThinking =
    caps.includes('always_thinking') || caps.includes('thinking') || model?.adaptiveThinking === true;

  if (!supportsThinking) {
    return `Thinking is ${levelLabel}. Current model does not support thinking.`;
  }

  const supportEfforts = model?.supportEfforts;
  const defaultEffort = model?.defaultEffort ?? 'high';

  if (supportEfforts !== undefined && supportEfforts.length > 0) {
    return `Thinking is ${levelLabel}. Default effort: ${defaultEffort}. Supported: ${supportEfforts.join(', ')}. Use /thinking <level>.`;
  }
  return `Thinking is ${levelLabel}. Default effort: ${defaultEffort}. Use /thinking <${formatThinkingLevels()}>.`;
}

async function applyPlanMode(host: SlashCommandHost, session: Session, enabled: boolean, ultra = false): Promise<void> {
  if (!enabled) {
    const run = await session.getUltraworkRun();
    if (isActiveUltraworkRun(run)) {
      host.showError(ultraworkModeDisableBlockedMessage(run));
      return;
    }
  }
  try {
    await session.setPlanMode(enabled, ultra);
    host.setAppState({ planMode: enabled, ultraworkMode: false, activityTip: null });
    if (enabled) {
      const plan = await session.getPlan().catch(() => null);
      host.showNotice(
        ultra ? 'UltraPlan mode: ON (structured pipeline)' : 'Plan mode: ON (free-form)',
        plan?.path !== undefined ? `Plan file: ${plan.path}` : undefined,
      );
      return;
    }
    host.showNotice('Plan mode: OFF');
  } catch (error) {
    const msg = formatErrorMessage(error);
    host.showError(`Failed to set plan mode: ${msg}`);
  }
}

export async function handleYoloCommand(host: SlashCommandHost, args: string): Promise<void> {
  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }

  const subcmd = args.trim().toLowerCase();
  const currentMode = host.state.appState.permissionMode;

  if (subcmd === 'on') {
    if (currentMode === 'yolo') {
      host.showNotice(ttui('tui.permission.yolo.alreadyOn'));
      return;
    }
    await session.setPermission('yolo');
    host.setAppState({ permissionMode: 'yolo' });
    void persistPermissionMode(host);
    host.showNotice(ttui('tui.permission.yolo.on.title'), ttui('tui.permission.yolo.on.detail'), { coalesceKey: 'permission-mode-yolo' });
    return;
  }

  if (subcmd === 'off') {
    if (currentMode !== 'yolo') {
      host.showNotice(ttui('tui.permission.yolo.alreadyOff'));
      return;
    }
    await session.setPermission('manual');
    host.setAppState({ permissionMode: 'manual' });
    void persistPermissionMode(host);
    host.showNotice(ttui('tui.permission.yolo.off.title'), undefined, { coalesceKey: 'permission-mode-yolo' });
    return;
  }

  // toggle
  if (currentMode === 'yolo') {
    await session.setPermission('manual');
    host.setAppState({ permissionMode: 'manual' });
    void persistPermissionMode(host);
    host.showNotice(ttui('tui.permission.yolo.off.title'), undefined, { coalesceKey: 'permission-mode-yolo' });
  } else {
    await session.setPermission('yolo');
    host.setAppState({ permissionMode: 'yolo' });
    void persistPermissionMode(host);
    host.showNotice(ttui('tui.permission.yolo.on.title'), ttui('tui.permission.yolo.on.detail'), { coalesceKey: 'permission-mode-yolo' });
  }
}

export async function handleAutoCommand(host: SlashCommandHost, args: string): Promise<void> {
  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }

  const subcmd = args.trim().toLowerCase();
  const currentMode = host.state.appState.permissionMode;

  if (subcmd === 'on') {
    if (currentMode === 'auto') {
      host.showNotice(ttui('tui.permission.auto.alreadyOn'));
      return;
    }
    await session.setPermission('auto');
    host.setAppState({ permissionMode: 'auto' });
    void persistPermissionMode(host);
    host.showNotice(ttui('tui.permission.auto.on.title'), ttui('tui.permission.auto.on.detail'), { coalesceKey: 'permission-mode-auto' });
    return;
  }

  if (subcmd === 'off') {
    if (currentMode !== 'auto') {
      host.showNotice(ttui('tui.permission.auto.alreadyOff'));
      return;
    }
    await session.setPermission('manual');
    host.setAppState({ permissionMode: 'manual' });
    void persistPermissionMode(host);
    host.showNotice(ttui('tui.permission.auto.off.title'), undefined, { coalesceKey: 'permission-mode-auto' });
    return;
  }

  // toggle
  if (currentMode === 'auto') {
    await session.setPermission('manual');
    host.setAppState({ permissionMode: 'manual' });
    void persistPermissionMode(host);
    host.showNotice(ttui('tui.permission.auto.off.title'), undefined, { coalesceKey: 'permission-mode-auto' });
  } else {
    await session.setPermission('auto');
    host.setAppState({ permissionMode: 'auto' });
    void persistPermissionMode(host);
    host.showNotice(ttui('tui.permission.auto.on.title'), ttui('tui.permission.auto.on.detail'), { coalesceKey: 'permission-mode-auto' });
  }
}

/** Fire-and-forget persistence of the current permission mode to tui.toml. */
function persistPermissionMode(host: SlashCommandHost): Promise<void> {
  return saveTuiConfig(tuiConfigFromHost(host));
}

export async function handleCompactCommand(host: SlashCommandHost, args: string): Promise<void> {
  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }
  const customInstruction = args.trim() || undefined;
  await session.compact({ instruction: customInstruction });
}

export async function handleEditorCommand(host: SlashCommandHost, args: string): Promise<void> {
  const command = args.trim();
  if (command.length === 0) {
    showEditorPicker(host);
    return;
  }
  await applyEditorChoice(host, command);
}

export async function handleThemeCommand(host: SlashCommandHost, args: string): Promise<void> {
  const theme = args.trim();
  if (theme.length === 0) {
    showThemePicker(host);
    return;
  }
  const importPrefix = 'import ';
  if (theme.startsWith(importPrefix)) {
    const source = theme.slice(importPrefix.length).trim();
    if (source.length === 0) {
      host.showError('Usage: /theme import <path|url|github:owner/repo/path>');
      return;
    }
    try {
      const result = await importThemeSource(source);
      host.showStatus(`Imported theme "${result.themeName}" from ${result.sourceKind}.`, 'success');
    } catch (error) {
      host.showError(`Failed to import theme: ${formatErrorMessage(error)}`);
    }
    return;
  }
  if (!isBuiltInTheme(theme)) {
    const custom = await loadCustomThemeMerged(theme);
    if (custom === null) {
      host.showError(`Unknown theme: ${theme}`);
      return;
    }
  }
  await applyThemeChoice(host, theme);
}

export async function handleAppearanceCommand(host: SlashCommandHost, args: string): Promise<void> {
  const raw = args.trim();
  if (raw.length === 0) {
    host.showNotice('Appearance', formatAppearanceStatus(currentAppearance(host)));
    return;
  }

  const [keyRaw, ...rest] = raw.split(/\s+/);
  const key = keyRaw?.toLowerCase();
  const value = rest.join(' ').trim().toLowerCase();
  if (key === 'help' || key === undefined || value.length === 0) {
    host.showNotice(
      'Appearance',
      `Usage: /appearance <${APPEARANCE_KEYS.join('|')}> <value>`,
    );
    return;
  }

  const previous = currentAppearance(host);
  const next = parseAppearancePatch(previous, key, value);
  if (next === null) {
    host.showError(`Unknown appearance option or value: ${raw}`);
    return;
  }
  if (JSON.stringify(next) === JSON.stringify(previous)) {
    host.showStatus('Appearance unchanged.');
    return;
  }

  try {
    await saveTuiConfig(tuiConfigFromHost(host, { appearance: next }));
  } catch (error) {
    host.showStatus(`Failed to save appearance: ${formatErrorMessage(error)}`, 'error');
    return;
  }

  host.setAppState({ appearance: next });
  host.track('appearance_changed', { key, value });
  host.showStatus(`Appearance ${key} set to ${value}.`, 'success');
}

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

// ---------------------------------------------------------------------------
// Pickers & config apply
// ---------------------------------------------------------------------------

function showEditorPicker(host: SlashCommandHost): void {
  const currentValue = host.state.appState.editorCommand ?? '';
  host.mountEditorReplacement(
    new EditorSelectorComponent({
      currentValue,
      onSelect: (value) => {
        host.restoreEditor();
        void applyEditorChoice(host, value);
      },
      onCancel: () => {
        host.restoreEditor();
      },
    }),
  );
}

async function refreshModelsForPicker(host: SlashCommandHost): Promise<void> {
  try {
    const result = await withTimeout(
      host.authFlow.refreshOAuthProviderModels(),
      MODEL_PICKER_REFRESH_TIMEOUT_MS,
    );
    if (result === undefined) return;
    for (const f of result.failed) {
      host.showStatus(`Skipped refreshing ${f.provider}: ${f.reason}`, 'warning');
    }
  } catch (error) {
    host.showStatus(`Skipped refreshing models: ${formatErrorMessage(error)}`, 'warning');
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

async function applyEditorChoice(host: SlashCommandHost, value: string): Promise<void> {
  const previous = host.state.appState.editorCommand ?? '';
  if (value === previous && value.length > 0) {
    host.showStatus(`Editor unchanged: ${value.length > 0 ? value : 'auto-detect'}`);
    return;
  }

  const editorCommand = value.length > 0 ? value : null;
  try {
    await saveTuiConfig(tuiConfigFromHost(host, { editorCommand }));
  } catch (error) {
    host.showStatus(
      `Failed to save editor: ${formatErrorMessage(error)}`,
      'error',
    );
    return;
  }

  host.setAppState({ editorCommand });
  host.showStatus(
    value.length > 0
      ? `Editor set to "${value}".`
      : 'Editor set to auto-detect ($VISUAL / $EDITOR).',
  );
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
  host.mountEditorReplacement(
    new TabbedModelSelectorComponent({
      models: host.state.appState.availableModels,
      currentValue: host.state.appState.model,
      selectedValue,
      currentThinking: host.state.appState.thinking,
      currentEffort,
      onSelect: ({ alias, thinking, effort }) => {
        host.restoreEditor();
        void performModelSwitch(host, alias, thinking, true, effort);
      },
      onSessionOnlySelect: ({ alias, thinking, effort }) => {
        host.restoreEditor();
        void performModelSwitch(host, alias, thinking, false, effort);
      },
      onCancel: () => {
        host.restoreEditor();
      },
    }),
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

function showThemePicker(host: SlashCommandHost): void {
  host.mountEditorReplacement(
    new ThemeSelectorComponent({
      currentValue: host.state.appState.theme,
      onSelect: (value) => {
        host.restoreEditor();
        void applyThemeChoice(host, value);
      },
      onCancel: () => {
        host.restoreEditor();
      },
    }),
  );
}

async function applyThemeChoice(host: SlashCommandHost, theme: ThemeName): Promise<void> {
  if (theme === host.state.appState.theme) {
    if (theme === 'auto') host.refreshTerminalThemeTracking();
    host.showStatus(`Theme unchanged: "${theme}".`);
    return;
  }

  // Validate custom themes up front so a missing / malformed file reports an
  // error instead of silently persisting a name that resolves to the dark
  // fallback.
  if (!isBuiltInTheme(theme)) {
    const palette = await loadCustomThemeMerged(theme);
    if (palette === null) {
      host.showStatus(`Theme "${theme}" could not be loaded.`, 'error');
      return;
    }
  }

  try {
    await saveTuiConfig(tuiConfigFromHost(host, { theme }));
  } catch (error) {
    host.showStatus(
      `Failed to save theme: ${formatErrorMessage(error)}`,
      'error',
    );
    return;
  }

  const resolved = theme === 'auto'
    ? (currentTheme.palette === lightColors ? 'light' : 'dark')
    : undefined;
  await host.applyTheme(theme, resolved);
  host.refreshTerminalThemeTracking();
  host.track('theme_switch', { theme });
  const detail = theme === 'auto' ? ` (tracking terminal; current: ${resolved})` : '';
  host.showStatus(`Theme set to "${theme}"${detail}.`);
}

export function showPermissionPicker(host: SlashCommandHost): void {
  host.mountEditorReplacement(
    new PermissionSelectorComponent({
      currentValue: host.state.appState.permissionMode,
      onSelect: (value) => {
        host.restoreEditor();
        void applyPermissionChoice(host, value);
      },
      onCancel: () => {
        host.restoreEditor();
      },
    }),
  );
}

export function showUpdatePreferencePicker(host: SlashCommandHost): void {
  host.mountEditorReplacement(
    new UpdatePreferenceSelectorComponent({
      currentValue: host.state.appState.upgrade.autoInstall,
      onSelect: (value) => {
        host.restoreEditor();
        void applyUpdatePreferenceChoice(host, value);
      },
      onCancel: () => {
        host.restoreEditor();
      },
    }),
  );
}

export async function showExperimentsPanel(host: SlashCommandHost): Promise<void> {
  let features: readonly ExperimentalFeatureState[];
  try {
    features = await host.harness.getExperimentalFeatures();
  } catch (error) {
    host.showError(`Failed to load experimental features: ${formatErrorMessage(error)}`);
    return;
  }
  mountExperimentsPanel(host, features);
}

export async function applyExperimentalFeatureChanges(
  host: SlashCommandHost,
  changes: readonly ExperimentalFeatureDraftChange[],
): Promise<void> {
  if (changes.length === 0) {
    host.showStatus(
      'No experimental feature changes to apply.',
      'textMuted',
    );
    return;
  }

  const experimental: Record<string, boolean> = {};
  for (const change of changes) {
    experimental[change.id] = change.enabled;
  }

  try {
    await host.harness.setConfig({ experimental });
    const features = await host.harness.getExperimentalFeatures();
    setExperimentalFeatures(features);
    host.refreshSlashCommandAutocomplete();
    host.restoreEditor();
    if (host.session !== undefined) {
      await host.session.reloadSession();
      await host.reloadCurrentSessionView(
        host.session,
        'Experimental features updated. Session reloaded.',
      );
    } else {
      host.showStatus('Experimental features updated.', 'success');
    }
    host.track('experimental_features_apply', { changed: changes.length });
  } catch (error) {
    host.showError(`Failed to update experimental features: ${formatErrorMessage(error)}`);
  }
}

function mountExperimentsPanel(
  host: SlashCommandHost,
  features: readonly ExperimentalFeatureState[],
): void {
  host.mountEditorReplacement(
    new ExperimentsSelectorComponent({
      features,
      onApply: (changes) => {
        void applyExperimentalFeatureChanges(host, changes);
      },
      onCancel: () => {
        host.restoreEditor();
      },
    }),
  );
}

type UpdatePreferenceHost = {
  readonly state: {
    readonly appState: Pick<
      SlashCommandHost['state']['appState'],
      'theme' | 'editorCommand' | 'notifications' | 'upgrade' | 'appearance' | 'disablePasteBurst' | 'permissionMode'
    >;
  };
  setAppState(patch: Pick<SlashCommandHost['state']['appState'], 'upgrade'>): void;
  showStatus(msg: string, color?: string): void;
  track: SlashCommandHost['track'];
};

export async function applyUpdatePreferenceChoice(
  host: UpdatePreferenceHost,
  autoInstall: boolean,
): Promise<void> {
  if (autoInstall === host.state.appState.upgrade.autoInstall) {
    host.showStatus(`Automatic updates already ${autoInstall ? 'enabled' : 'disabled'}.`);
    return;
  }

  const upgrade = { autoInstall };
  try {
    await saveTuiConfig(tuiConfigFromHost(host, { upgrade }));
  } catch (error) {
    host.showStatus(
      `Failed to save automatic update setting: ${formatErrorMessage(error)}`,
      'error',
    );
    return;
  }

  host.setAppState({ upgrade });
  host.track('upgrade_preference_changed', { auto_install: autoInstall });
  host.showStatus(`Automatic updates ${autoInstall ? 'enabled' : 'disabled'}.`);
}

async function applyPermissionChoice(host: SlashCommandHost, mode: PermissionMode): Promise<void> {
  if (mode === host.state.appState.permissionMode) {
    host.showStatus(ttui('tui.permission.mode.unchanged', { mode }));
    return;
  }

  try {
    await host.requireSession().setPermission(mode);
  } catch (error) {
    const msg = formatErrorMessage(error);
    host.showError(`Failed to set permission mode: ${msg}`);
    return;
  }

  host.setAppState({ permissionMode: mode });
  host.showNotice(ttui('tui.permission.mode.set', { mode }));
}

export function showSettingsSelector(host: SlashCommandHost): void {
  host.mountEditorReplacement(
    new SettingsSelectorComponent({
      onSelect: (value) => {
        handleSettingsSelection(host, value);
      },
      onCancel: () => {
        host.restoreEditor();
      },
    }),
  );
}

function handleSettingsSelection(host: SlashCommandHost, value: SettingsSelection): void {
  host.restoreEditor();
  switch (value) {
    case 'model': showModelPicker(host); return;
    case 'permission': showPermissionPicker(host); return;
    case 'accounts': void handleAccountsCommand(host); return;
    case 'context': void showContextWorkingSetPicker(host); return;
    case 'harness': showHarnessPanel(host); return;
    case 'tools': void showToolsInventory(host); return;
    case 'premium': void handlePremiumQualityCommand(host, ''); return;
    case 'mcp': void showMcpServers(host); return;
    case 'theme': showThemePicker(host); return;
    case 'appearance': void handleAppearanceCommand(host, ''); return;
    case 'editor': showEditorPicker(host); return;
    case 'experiments': void showExperimentsPanel(host); return;
    case 'upgrade': showUpdatePreferencePicker(host); return;
    case 'persona': void handlePersonaCommand(host, ''); return;
    case 'usage': void showUsage(host); return;
  }
}

/**
 * Settings → Harness: hub for previously buried eyes/hands controls
 * (tools inventory, premium, MCP, experiments).
 */
export function showHarnessPanel(host: SlashCommandHost): void {
  host.mountEditorReplacement(
    new ChoicePickerComponent({
      title: 'Harness',
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
        {
          value: 'tools',
          label: 'Tools inventory',
          description: 'List active agent tools (SearchTools surface).',
        },
        {
          value: 'premium',
          label: 'Premium Quality',
          description: 'Toggle visual-first premium harness.',
        },
        {
          value: 'mcp',
          label: 'MCP servers',
          description: 'Model Context Protocol server status.',
        },
        {
          value: 'experiments',
          label: 'Experiments',
          description: 'Feature flags (micro compaction, codegraph, …).',
        },
        {
          value: 'context',
          label: 'Context working set',
          description: 'Auto-compaction / working-set presets.',
        },
      ],
      onSelect: (value) => {
        host.restoreEditor();
        switch (value) {
          case 'tools':
            void showToolsInventory(host);
            return;
          case 'premium':
            void handlePremiumQualityCommand(host, '');
            return;
          case 'mcp':
            void showMcpServers(host);
            return;
          case 'experiments':
            void showExperimentsPanel(host);
            return;
          case 'context':
            void showContextWorkingSetPicker(host);
            return;
          default:
            return;
        }
      },
      onCancel: () => {
        host.restoreEditor();
      },
    }),
  );
}

/** List active tools for the current session (TUI eyes for the tool surface). */
export async function showToolsInventory(host: SlashCommandHost): Promise<void> {
  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }
  if (typeof session.getTools !== 'function') {
    host.showError('Tools inventory is not available on this session.');
    return;
  }
  try {
    const tools = await session.getTools();
    const active = tools.filter((tool) => tool.active);
    const inactive = tools.filter((tool) => !tool.active);
    const bySource = (list: typeof tools) => {
      const m = new Map<string, number>();
      for (const tool of list) {
        m.set(tool.source, (m.get(tool.source) ?? 0) + 1);
      }
      return [...m.entries()].map(([k, v]) => `${k}:${String(v)}`).join(' · ') || 'none';
    };
    const lines: string[] = [
      `Tools: ${String(active.length)} active / ${String(tools.length)} registered (${bySource(tools)})`,
      '',
      'Active:',
    ];
    const sorted = [...active].sort((a, b) => a.name.localeCompare(b.name));
    const cap = 48;
    for (const tool of sorted.slice(0, cap)) {
      const desc = tool.description.replace(/\s+/g, ' ').trim();
      const short = desc.length > 72 ? `${desc.slice(0, 69)}…` : desc;
      lines.push(`  ${tool.name}  [${tool.source}]  ${short}`);
    }
    if (sorted.length > cap) {
      lines.push(`  … +${String(sorted.length - cap)} more active`);
    }
    if (inactive.length > 0) {
      lines.push('', `Inactive (${String(inactive.length)}): ${inactive.map((t) => t.name).sort().slice(0, 24).join(', ')}${inactive.length > 24 ? '…' : ''}`);
    }
    lines.push('', 'Tip: agent can call SearchTools for the same inventory mid-turn.');
    host.showNotice(lines.join('\n'));
  } catch (error) {
    host.showError(`Failed to load tools: ${formatErrorMessage(error)}`);
  }
}

/**
 * /context [economy|balanced|deep|full|status] — open the working-set picker
 * or apply a named preset without the dialog.
 */
export async function handleContextCommand(
  host: SlashCommandHost,
  args: string,
): Promise<void> {
  const raw = args.trim().toLowerCase();
  if (raw.length === 0) {
    await showContextWorkingSetPicker(host);
    return;
  }
  if (raw === 'status' || raw === 'show') {
    await showContextWorkingSetStatus(host);
    return;
  }
  const presetId = normalizeContextPresetArg(raw);
  if (presetId === undefined) {
    host.showError(
      `Unknown context preset: ${args.trim()}. Use economy, balanced, deep, full, or status.`,
    );
    return;
  }
  await applyContextWorkingSetPreset(host, presetId);
}

export async function showContextWorkingSetPicker(host: SlashCommandHost): Promise<void> {
  let currentPresetId: ContextWorkingSetPresetId | undefined;
  let maxContextTokens: number | undefined;
  try {
    const config = await host.harness.getConfig({ reload: true });
    currentPresetId = matchContextWorkingSetPreset({
      maxWorkingSetTokens: config.loopControl?.maxWorkingSetTokens,
      asyncWorkingSetTokens: config.loopControl?.asyncWorkingSetTokens,
    });
    maxContextTokens = resolveActiveMaxContextTokens(host);
  } catch (error) {
    host.showError(`Failed to load context settings: ${formatErrorMessage(error)}`);
    return;
  }

  host.mountEditorReplacement(
    new ContextWorkingSetSelectorComponent({
      currentPresetId,
      maxContextTokens,
      onSelect: (presetId) => {
        host.restoreEditor();
        void applyContextWorkingSetPreset(host, presetId);
      },
      onCancel: () => {
        host.restoreEditor();
      },
    }),
  );
}

async function showContextWorkingSetStatus(host: SlashCommandHost): Promise<void> {
  try {
    const config = await host.harness.getConfig({ reload: true });
    const max = config.loopControl?.maxWorkingSetTokens;
    const async = config.loopControl?.asyncWorkingSetTokens;
    const matched = matchContextWorkingSetPreset({
      maxWorkingSetTokens: max,
      asyncWorkingSetTokens: async,
    });
    const maxContextTokens = resolveActiveMaxContextTokens(host);
    const preset = matched !== undefined ? contextWorkingSetPresetById(matched) : undefined;
    const preview =
      preset !== undefined
        ? previewContextWorkingSet({ preset, maxContextTokens })
        : undefined;
    const lines = [
      `Context working set: ${matched ?? 'custom'}`,
      `  maxWorkingSetTokens: ${max === undefined ? 'default' : formatTokenCount(max)}`,
      `  asyncWorkingSetTokens: ${async === undefined ? 'default' : formatTokenCount(async)}`,
      `  model window: ${
        maxContextTokens !== undefined ? formatTokenCount(maxContextTokens) : 'unknown'
      }`,
    ];
    if (preview !== undefined) {
      lines.push(`  effective: ${preview.softLabel} · ${preview.asyncLabel}`);
    }
    host.showStatus(lines.join('\n'));
  } catch (error) {
    host.showError(`Failed to read context settings: ${formatErrorMessage(error)}`);
  }
}

async function applyContextWorkingSetPreset(
  host: SlashCommandHost,
  presetId: ContextWorkingSetPresetId,
): Promise<void> {
  const preset = contextWorkingSetPresetById(presetId);
  if (preset === undefined) {
    host.showError(`Unknown context preset: ${presetId}`);
    return;
  }

  try {
    const config = await host.harness.getConfig({ reload: true });
    const patch = loopControlPatchForPreset(preset);
    await host.harness.setConfig({
      loopControl: {
        ...config.loopControl,
        maxWorkingSetTokens: patch.maxWorkingSetTokens,
        asyncWorkingSetTokens: patch.asyncWorkingSetTokens,
      },
    });

    host.setAppState({
      workingSet: contextWorkingSetSnapshotFromLoopControl({
        maxWorkingSetTokens: patch.maxWorkingSetTokens,
        asyncWorkingSetTokens: patch.asyncWorkingSetTokens,
      }),
    });

    const maxContextTokens = resolveActiveMaxContextTokens(host);
    const preview = previewContextWorkingSet({ preset, maxContextTokens });
    host.track('context_working_set_changed', { preset: presetId });
    host.showStatus(
      `Context set to ${preset.label}. ${preview.softLabel} · ${preview.asyncLabel} (window ${preview.windowLabel}). Reload the session if a turn is already in progress.`,
      'success',
    );
  } catch (error) {
    host.showError(`Failed to update context settings: ${formatErrorMessage(error)}`);
  }
}

function resolveActiveMaxContextTokens(host: SlashCommandHost): number | undefined {
  const alias = host.state.appState.model.trim();
  if (alias.length === 0) return undefined;
  const model = host.state.appState.availableModels[alias];
  const size = model?.maxContextSize;
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) return undefined;
  return size;
}

function normalizeContextPresetArg(raw: string): ContextWorkingSetPresetId | undefined {
  if (raw === 'balanced' || raw === 'default' || raw === 'smart') return 'balanced';
  if (raw === 'economy' || raw === 'cheap' || raw === 'low') return 'economy';
  if (raw === 'deep' || raw === 'large' || raw === 'long') return 'deep';
  if (raw === 'full' || raw === 'full_window' || raw === 'full-window' || raw === 'off') {
    return 'full_window';
  }
  return undefined;
}

function currentAppearance(host: {
  readonly state: { readonly appState: { readonly appearance?: AppearancePreferences } };
}): AppearancePreferences {
  return host.state.appState.appearance ?? DEFAULT_APPEARANCE_PREFERENCES;
}

function tuiConfigFromHost(
  host: {
    readonly state: {
      readonly appState: Pick<
        SlashCommandHost['state']['appState'],
        'theme' | 'editorCommand' | 'notifications' | 'upgrade' | 'disablePasteBurst' | 'permissionMode'
      > & { readonly appearance?: AppearancePreferences };
    };
  },
  patch: Partial<TuiConfig> = {},
): TuiConfig {
  return {
    theme: host.state.appState.theme,
    permissionMode: host.state.appState.permissionMode,
    disablePasteBurst: host.state.appState.disablePasteBurst ?? false,
    editorCommand: host.state.appState.editorCommand,
    notifications: host.state.appState.notifications,
    upgrade: host.state.appState.upgrade,
    appearance: currentAppearance(host),
    ...patch,
  };
}

function formatAppearanceStatus(appearance: AppearancePreferences): string {
  return [
    `profile: ${appearance.profile}`,
    `density: ${appearance.density}`,
    `${ttui('tui.appearance.timestamps')}: ${appearance.showTimestamps ? 'on' : 'off'}`,
    `particles: ${appearance.particles}`,
    `animation-fps: ${String(appearance.animationFps)}`,
    `canvas-background: ${appearance.canvasBackground ? 'on' : 'off'}`,
    `terminal-background: ${appearance.terminalBackground}`,
    `terminal-palette: ${appearance.terminalPalette ? 'on' : 'off'}`,
  ].join('\n');
}

function parseAppearancePatch(
  previous: AppearancePreferences,
  key: string,
  value: string,
): AppearancePreferences | null {
  const next: AppearancePreferences = { ...previous };
  switch (key) {
    case 'profile':
      if (!isOneOf(value, ['auto', 'off', 'subtle', 'premium'])) return null;
      next.profile = value;
      return next;
    case 'density':
      if (!isOneOf(value, ['auto', 'compact', 'comfortable', 'spacious'])) return null;
      next.density = value;
      return next;
    case 'timestamps':
      {
        const enabled = parseOnOff(value);
        if (enabled === undefined) return null;
        next.showTimestamps = enabled;
        return next;
      }
    case 'particles':
      if (!isOneOf(value, ['auto', 'off', 'ambient', 'events', 'premium'])) return null;
      next.particles = value;
      return next;
    case 'animation-fps': {
      const fps = Number.parseInt(value, 10);
      if (!Number.isInteger(fps) || fps < 1 || fps > 60) return null;
      next.animationFps = fps;
      return next;
    }
    case 'canvas-background':
      {
        const enabled = parseOnOff(value);
        if (enabled === undefined) return null;
        next.canvasBackground = enabled;
        return next;
      }
    case 'terminal-background':
      if (!isOneOf(value, ['off', 'session'])) return null;
      next.terminalBackground = value;
      return next;
    case 'terminal-palette':
      {
        const enabled = parseOnOff(value);
        if (enabled === undefined) return null;
        next.terminalPalette = enabled;
        return next;
      }
    default:
      return null;
  }
}

function parseOnOff(value: string): boolean | undefined {
  if (value === 'on' || value === 'true' || value === 'yes') return true;
  if (value === 'off' || value === 'false' || value === 'no') return false;
  return undefined;
}

function isOneOf<const T extends readonly string[]>(value: string, choices: T): value is T[number] {
  return choices.includes(value as T[number]);
}
