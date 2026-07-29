import type {
  ExperimentalFeatureState,
  ModelAlias,
  PermissionMode,
  Session,
} from '@superliora/sdk';

import { ChoicePickerComponent } from '../components/dialogs/choice-picker';
import { EditorSelectorComponent } from '../components/dialogs/editor-selector';
import {
  ExperimentsSelectorComponent,
  type ExperimentalFeatureDraftChange,
} from '../components/dialogs/experiments-selector';
import { PermissionSelectorComponent } from '../components/dialogs/permission-selector';
import { SettingsSelectorComponent, type SettingsSelection } from '../components/dialogs/settings-selector';
import { ThemeSelectorComponent } from '../components/dialogs/theme-selector';
import { UpdatePreferenceSelectorComponent } from '../components/dialogs/update-preference-selector';
import {
  DEFAULT_APPEARANCE_PREFERENCES,
  DEFAULT_ONBOARDING_PREFERENCES,
  saveTuiConfig,
  type AppearancePreferences,
  type OnboardingPreferences,
  type TuiConfig,
} from '../config';
import type { ThemeName } from '#/tui/theme';
import { currentTheme, isBuiltInTheme, lightColors, loadCustomThemeMerged } from '#/tui/theme';
import { importThemeSource } from '#/tui/theme/importer';
import { LLM_NOT_SET_MESSAGE, NO_ACTIVE_SESSION_MESSAGE } from '../constant/liora-tui';
import { formatErrorMessage } from '../utils/event-payload';
import { dismissPickerDialog, mountPickerDialog } from '../utils/mount-picker';
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
import { showModelPicker, showLoopModelRoutingPicker, showModelFallbackPicker } from './config-model';
import { showContextWorkingSetPicker } from './config-context';
import { isActiveUltraworkRun, ultraworkModeDisableBlockedMessage } from './ultrawork-contract';
import {
  formatHarnessEyesReadiness,
  loadHarnessEyesReadiness,
} from '#/tui/utils/harness-eyes-readiness';
import { getHostPackageRoot } from '#/cli/version';
import { ttui } from '#/tui/utils/tui-i18n';
import { isTranscriptDetailLevel } from '#/tui/utils/transcript-density';

// ---------------------------------------------------------------------------
// Plan / Config commands
// ---------------------------------------------------------------------------

export { handleModelCommand, showLoopModelRoutingPicker, applyLoopModelRoutingChoice, resetLoopModelRoutingChoice, showModelFallbackPicker, showModelPicker } from './config-model';
export { handleContextCommand, showContextWorkingSetPicker } from './config-context';

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
  'transcript-detail',
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
  if (key === 'transcript-detail') {
    // Live re-projection of mounted tool cards; the save above persists.
    host.setTranscriptDetail(next.transcriptDetail);
  }
  host.track('appearance_changed', { key, value });
  host.showStatus(`Appearance ${key} set to ${value}.`, 'success');
}

// ---------------------------------------------------------------------------
// Pickers & config apply
// ---------------------------------------------------------------------------

function showEditorPicker(host: SlashCommandHost): void {
  const currentValue = host.state.appState.editorCommand ?? '';
  mountPickerDialog(host, 
    new EditorSelectorComponent({
      currentValue,
      onSelect: (value) => {
        dismissPickerDialog(host);
        void applyEditorChoice(host, value);
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
  );
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

function showThemePicker(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ThemeSelectorComponent({
      currentValue: host.state.appState.theme,
      onSelect: (value) => {
        dismissPickerDialog(host);
        void applyThemeChoice(host, value);
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Theme' },
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
  mountPickerDialog(
    host,
    new PermissionSelectorComponent({
      currentValue: host.state.appState.permissionMode,
      onSelect: (value) => {
        dismissPickerDialog(host);
        void applyPermissionChoice(host, value);
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Permission' },
  );
}

function isPermissionModeArg(value: string): value is PermissionMode {
  return value === 'manual' || value === 'auto' || value === 'yolo';
}

/**
 * `/permission [manual|auto|yolo]` — set the mode directly, or open the picker
 * when no valid mode token is provided.
 */
export async function handlePermissionCommand(
  host: SlashCommandHost,
  args: string,
): Promise<void> {
  const token = args.trim().toLowerCase().split(/\s+/)[0] ?? '';
  if (token.length === 0) {
    showPermissionPicker(host);
    return;
  }
  if (!isPermissionModeArg(token)) {
    host.showError(
      `Unknown permission mode: ${token}. Use manual, auto, or yolo (or omit args for the picker).`,
    );
    return;
  }
  await applyPermissionChoice(host, token);
}

/**
 * Settings → Media fallback: policy for attached images/videos when the
 * current chat model is text-only. Persisted to config.toml `[media]`.
 */
export function showMediaFallbackPicker(host: SlashCommandHost): void {
  const current = host.state.appState.nonVisionFallbackPolicy;
  const mark = (value: string, label: string): string =>
    value === current ? `${label} ✓` : label;
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Media fallback (text-only model)',
      hint: '↑↓ · Enter · Esc',
      options: [
        {
          value: 'analyze',
          label: mark('analyze', 'Analyze with a vision model'),
          description: 'Render attached media to text with a vision-capable catalog model.',
        },
        {
          value: 'path',
          label: mark('path', 'Attach path note'),
          description: 'Replace media with a pointer so a vision tool can read it later.',
        },
        {
          value: 'block',
          label: mark('block', 'Block the send'),
          description: 'Refuse prompts with media while the current model is text-only.',
        },
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'analyze' || value === 'path' || value === 'block') {
          void applyMediaFallbackPolicy(host, value);
        }
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
  );
}

async function applyMediaFallbackPolicy(
  host: SlashCommandHost,
  policy: 'analyze' | 'path' | 'block',
): Promise<void> {
  try {
    await host.harness.setConfig({ media: { nonVisionFallback: policy } });
    host.setAppState({ nonVisionFallbackPolicy: policy });
    host.showStatus(`Media fallback set to '${policy}'.`, 'success');
  } catch (error) {
    host.showError(`Failed to update media fallback: ${formatErrorMessage(error)}`);
  }
}

export function showUpdatePreferencePicker(host: SlashCommandHost): void {
  mountPickerDialog(host, 
    new UpdatePreferenceSelectorComponent({
      currentValue: host.state.appState.upgrade.autoInstall,
      onSelect: (value) => {
        dismissPickerDialog(host);
        void applyUpdatePreferenceChoice(host, value);
      },
      onCancel: () => {
        dismissPickerDialog(host);
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
    dismissPickerDialog(host);
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
  mountPickerDialog(host, 
    new ExperimentsSelectorComponent({
      features,
      onApply: (changes) => {
        void applyExperimentalFeatureChanges(host, changes);
      },
      onCancel: () => {
        dismissPickerDialog(host);
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
  mountPickerDialog(
    host,
    new SettingsSelectorComponent({
      onSelect: (value) => {
        handleSettingsSelection(host, value);
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Settings' },
  );
}

function handleSettingsSelection(host: SlashCommandHost, value: SettingsSelection): void {
  dismissPickerDialog(host);
  switch (value) {
    case 'model': showModelPicker(host); return;
    case 'model-routing': void showLoopModelRoutingPicker(host); return;
    case 'model-fallback': void showModelFallbackPicker(host); return;
    case 'permission': showPermissionPicker(host); return;
    case 'accounts': void handleAccountsCommand(host); return;
    case 'context': void showContextWorkingSetPicker(host); return;
    case 'media': void showMediaFallbackPicker(host); return;
    case 'harness': showHarnessPanel(host); return;
    case 'tools': void showToolsInventory(host); return;
    case 'eyes': void showHarnessEyesReadiness(host); return;
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
  mountPickerDialog(host, 
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
          value: 'eyes',
          label: 'Eyes readiness',
          description: 'Browser-use / computer-use runtime status.',
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
        dismissPickerDialog(host);
        switch (value) {
          case 'tools':
            void showToolsInventory(host);
            return;
          case 'eyes':
            void showHarnessEyesReadiness(host);
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
        dismissPickerDialog(host);
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


/** Browser-use / computer-use runtime readiness (Harness eyes). */
export async function showHarnessEyesReadiness(host: SlashCommandHost): Promise<void> {
  try {
    const report = await loadHarnessEyesReadiness({ packageRoot: getHostPackageRoot() });
    host.showNotice(formatHarnessEyesReadiness(report));
  } catch (error) {
    host.showError(`Failed to load eyes readiness: ${formatErrorMessage(error)}`);
  }
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
      > & {
        readonly appearance?: AppearancePreferences;
        readonly onboarding?: OnboardingPreferences;
      };
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
    onboarding: host.state.appState.onboarding ?? DEFAULT_ONBOARDING_PREFERENCES,
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
    `transcript-detail: ${appearance.transcriptDetail}`,
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
    case 'transcript-detail':
      if (!isTranscriptDetailLevel(value)) return null;
      next.transcriptDetail = value;
      return next;
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
