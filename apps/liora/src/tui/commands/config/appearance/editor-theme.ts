import { EditorSelectorComponent } from '../../../components/dialogs/picker/editor-selector';
import { ThemeSelectorComponent } from '../../../components/dialogs/picker/theme-selector';
import { saveTuiConfig } from '../../../config';
import type { ThemeName } from '#/tui/theme';
import { currentTheme, isBuiltInTheme, lightColors, loadCustomThemeMerged } from '#/tui/theme';
import { importThemeSource } from '#/tui/theme/importer';
import { formatErrorMessage } from '../../../utils/event-payload';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';
import type { SlashCommandHost } from '../../hub/dispatch';
import { tuiConfigFromHost } from './tui-persist';
import { ttui } from '../../../utils/tui-i18n';

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
      host.showError(ttui('tui.theme.importUsage'));
      return;
    }
    try {
      const result = await importThemeSource(source);
      host.showStatus(ttui('tui.theme.imported', { name: result.themeName, source: result.sourceKind }), 'success');
    } catch (error) {
      host.showError(ttui('tui.theme.importFailed', { message: formatErrorMessage(error) }));
    }
    return;
  }
  if (!isBuiltInTheme(theme)) {
    const custom = await loadCustomThemeMerged(theme);
    if (custom === null) {
      host.showError(ttui('tui.theme.unknown', { theme }));
      return;
    }
  }
  await applyThemeChoice(host, theme);
}

export function showEditorPicker(host: SlashCommandHost): void {
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
    host.showStatus(ttui('tui.theme.editorUnchanged', { value: value.length > 0 ? value : 'auto-detect' }));
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

export function showThemePicker(host: SlashCommandHost): void {
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
    host.showStatus(ttui('tui.theme.unchanged', { theme }));
    return;
  }

  // Validate custom themes up front so a missing / malformed file reports an
  // error instead of silently persisting a name that resolves to the dark
  // fallback.
  if (!isBuiltInTheme(theme)) {
    const palette = await loadCustomThemeMerged(theme);
    if (palette === null) {
      host.showStatus(ttui('tui.theme.loadFailed', { theme }), 'error');
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
  host.showStatus(ttui('tui.theme.set', { theme, detail }));
}
