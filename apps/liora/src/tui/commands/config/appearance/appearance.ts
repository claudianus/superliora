/**
 * /appearance slash command and appearance preference parsing extracted from config.ts.
 */

import { saveTuiConfig, type AppearancePreferences } from '../../../config';
import { formatErrorMessage } from '../../../utils/event-payload';
import { ttui } from '#/tui/utils/tui-i18n';
import { parseAppearancePatch } from '#/tui/utils/appearance/appearance-patch';
import { currentAppearance, tuiConfigFromHost } from './tui-persist';
import type { SlashCommandHost } from '../../hub/dispatch';

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
  'mission-control',
  'worker-dock',
  'neat',
  'syntax-theme',
] as const;

export async function handleAppearanceCommand(host: SlashCommandHost, args: string): Promise<void> {
  const raw = args.trim();
  if (raw.length === 0) {
    host.showNotice(ttui('tui.appearance.title'), formatAppearanceStatus(currentAppearance(host)));
    return;
  }

  const [keyRaw, ...rest] = raw.split(/\s+/);
  const key = keyRaw?.toLowerCase();
  const value = rest.join(' ').trim().toLowerCase();
  if (key === 'help' || key === undefined || value.length === 0) {
    host.showNotice(
      ttui('tui.appearance.title'),
      `Usage: /appearance <${APPEARANCE_KEYS.join('|')}> <value>`,
    );
    return;
  }

  await commitAppearanceChange(host, currentAppearance(host), key, value, raw);
}

/** Keys that mutate the host terminal (OSC). Highlight-preview skips these. */
const OSC_APPEARANCE_KEYS = new Set(['terminal-background', 'terminal-palette']);

export function canLivePreviewAppearanceKey(key: string): boolean {
  return !OSC_APPEARANCE_KEYS.has(key);
}

/** Apply an appearance patch to the live TUI without writing tui.toml. */
export function previewAppearanceChange(
  host: SlashCommandHost,
  previous: AppearancePreferences,
  key: string,
  value: string,
): void {
  if (!canLivePreviewAppearanceKey(key)) return;
  const next = parseAppearancePatch(previous, key, value);
  if (next === null) return;
  applyAppearanceLive(host, next, key);
}

/** Restore the last committed appearance after a cancelled highlight preview. */
export function restoreAppearancePreview(
  host: SlashCommandHost,
  previous: AppearancePreferences,
  key: string,
): void {
  if (!canLivePreviewAppearanceKey(key)) return;
  applyAppearanceLive(host, previous, key);
}

/**
 * Persist an appearance patch from a known baseline.
 * Callers that highlight-preview must pass the committed prefs, not the live
 * preview state — otherwise an already-applied highlight looks "unchanged"
 * and never writes tui.toml.
 */
export async function commitAppearanceChange(
  host: SlashCommandHost,
  previous: AppearancePreferences,
  key: string,
  value: string,
  raw = `${key} ${value}`,
): Promise<void> {
  const next = parseAppearancePatch(previous, key, value);
  if (next === null) {
    host.showError(ttui('tui.appearance.unknownOption', { raw }));
    return;
  }
  if (JSON.stringify(next) === JSON.stringify(previous)) {
    host.showStatus(ttui('tui.appearance.unchanged'));
    return;
  }

  try {
    await saveTuiConfig(tuiConfigFromHost(host, { appearance: next }));
  } catch (error) {
    host.showStatus(ttui('tui.appearance.saveFailed', { message: formatErrorMessage(error) }), 'error');
    return;
  }

  applyAppearanceLive(host, next, key);
  host.track('appearance_changed', { key, value });
  host.showStatus(ttui('tui.appearance.set', { key, value }), 'success');
}

function applyAppearanceLive(
  host: SlashCommandHost,
  next: AppearancePreferences,
  key: string,
): void {
  host.setAppState({ appearance: next });
  if (key === 'transcript-detail') {
    host.setTranscriptDetail(next.transcriptDetail);
  } else if (key === 'neat') {
    host.setNeatMode(next.neat);
  }
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
    `worker-dock: ${appearance.workerDock}`,
    `neat: ${appearance.neat ? 'on' : 'off'}`,
    `syntax-theme: ${appearance.syntaxTheme}`,
  ].join('\n');
}

export { parseAppearancePatch } from '#/tui/utils/appearance/appearance-patch';
