import type { LioraConfig } from '@superliora/sdk';

import { currentTheme, lightColors } from '#/tui/theme';
import { DEFAULT_APPEARANCE_PREFERENCES, loadTuiConfig, type TuiConfig } from '../config';
import type { SlashCommandHost } from './dispatch';
import { setExperimentalFeatures } from './experimental-flags';

export async function handleReloadTuiCommand(host: SlashCommandHost): Promise<void> {
  const tuiConfig = await loadTuiConfig();
  await applyReloadedTuiConfig(host, tuiConfig);
  host.showStatus('TUI config reloaded.', 'success');
}

export async function handleReloadCommand(host: SlashCommandHost): Promise<void> {
  const tuiConfig = await loadTuiConfig();
  const session = host.session;

  if (session !== undefined) {
    await session.reloadSession({ forcePluginSessionStartReminder: true });
    await host.reloadCurrentSessionView(session, 'Session reloaded.');
  }

  const config = await host.harness.getConfig({ reload: true });
  setExperimentalFeatures(await host.harness.getExperimentalFeatures(), true);
  host.refreshSlashCommandAutocomplete();
  applyRuntimeConfig(host, config);
  await applyReloadedTuiConfig(host, tuiConfig);

  if (session === undefined) {
    host.showStatus(
      'Runtime and TUI config reloaded; no active session.',
      'success',
    );
  }
}

export async function applyReloadedTuiConfig(
  host: SlashCommandHost,
  config: TuiConfig,
): Promise<void> {
  const resolved = config.theme === 'auto'
    ? (currentTheme.palette === lightColors ? 'light' : 'dark')
    : undefined;
  await host.applyTheme(config.theme, resolved);
  host.refreshTerminalThemeTracking();
  host.setAppState({
    editorCommand: config.editorCommand,
    disablePasteBurst: config.disablePasteBurst,
    notifications: config.notifications,
    upgrade: config.upgrade,
    appearance: config.appearance ?? DEFAULT_APPEARANCE_PREFERENCES,
  });
  if ('setDisablePasteBurst' in host.state.editor) {
    (host.state.editor as { setDisablePasteBurst(disabled: boolean): void }).setDisablePasteBurst(
      config.disablePasteBurst,
    );
  }
}

function applyRuntimeConfig(host: SlashCommandHost, config: LioraConfig): void {
  host.setAppState({
    availableModels: config.models ?? {},
    availableProviders: config.providers ?? {},
  });
}
