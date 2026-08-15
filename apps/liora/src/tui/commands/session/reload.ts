import type { LioraConfig } from '@superliora/sdk';

import { currentTheme, lightColors } from '#/tui/theme';
import {
  DEFAULT_APPEARANCE_PREFERENCES,
  DEFAULT_FOOTER_PREFERENCES,
  loadTuiConfig,
  type TuiConfig,
} from '../../config';
import { resolveEffectiveAppearance } from '../../features/appearance/performance-mode';
import type { SlashCommandHost } from '../hub/dispatch';
import { setExperimentalFeatures } from '../experimental-flags';
import { resolveCliLocale, setCliLocale } from '#/cli/i18n';
import { formatErrorMessage } from '#/tui/utils/event-payload';
import { restoreTuiSessionState } from '#/tui/utils/tui-session-state';
import { ttui } from '../../utils/tui-i18n';

export async function handleReloadTuiCommand(host: SlashCommandHost): Promise<void> {
  const tuiConfig = await loadTuiConfig();
  await applyReloadedTuiConfig(host, tuiConfig);
  host.showStatus(ttui('tui.session.tuiReloaded'), 'success');
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
  if (host.session !== undefined) {
    try {
      await host.session.setPermission(config.permissionMode);
    } catch (error) {
      host.showError(ttui('tui.session.reloadPermissionFailed', { message: formatErrorMessage(error) }));
    }
  }
  const appearance = config.appearance ?? DEFAULT_APPEARANCE_PREFERENCES;
  host.setAppState({
    permissionMode: config.permissionMode,
    editorCommand: config.editorCommand,
    disablePasteBurst: config.disablePasteBurst,
    notifications: config.notifications,
    upgrade: config.upgrade,
    appearance,
    footer: config.footer ?? DEFAULT_FOOTER_PREFERENCES,
    locale: config.locale,
    performanceMode: config.performanceMode,
  });
  setCliLocale(resolveCliLocale({ preference: config.locale, env: process.env }));
  // Live density follows performance overlay when active; stored prefs stay.
  const effective = resolveEffectiveAppearance(config.performanceMode, appearance);
  host.setTranscriptDetail(effective.transcriptDetail);
  host.setNeatMode(effective.neat);
  if ('setDisablePasteBurst' in host.state.editor) {
    (host.state.editor as { setDisablePasteBurst(disabled: boolean): void }).setDisablePasteBurst(
      config.disablePasteBurst,
    );
  }
  await restoreTuiSessionState(host);
}

function applyRuntimeConfig(host: SlashCommandHost, config: LioraConfig): void {
  host.setAppState({
    availableModels: config.models ?? {},
    availableProviders: config.providers ?? {},
    nonVisionFallbackPolicy: config.media?.nonVisionFallback ?? 'analyze',
  });
}
