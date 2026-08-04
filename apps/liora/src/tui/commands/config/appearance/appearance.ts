/**
 * /appearance slash command and appearance preference parsing extracted from config.ts.
 */

import { saveTuiConfig, type AppearancePreferences } from '../../../config';
import { formatErrorMessage } from '../../../utils/event-payload';
import { ttui } from '#/tui/utils/tui-i18n';
import { isTranscriptDetailLevel } from '#/tui/features/transcript/transcript-density';
import { isSyntaxThemeId } from '#/tui/theme/syntax-theme';
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
  'neat',
  'syntax-theme',
] as const;

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
  // setAppState re-applies appearance (syntax theme + Shiki caches included).
  if (key === 'transcript-detail') {
    // Live re-projection of mounted tool cards; the save above persists.
    host.setTranscriptDetail(next.transcriptDetail);
  } else if (key === 'neat') {
    host.setNeatMode(next.neat);
  }
  host.track('appearance_changed', { key, value });
  host.showStatus(`Appearance ${key} set to ${value}.`, 'success');
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
    `neat: ${appearance.neat ? 'on' : 'off'}`,
    `syntax-theme: ${appearance.syntaxTheme}`,
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
    case 'neat':
      {
        const enabled = parseOnOff(value);
        if (enabled === undefined) return null;
        next.neat = enabled;
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
    case 'syntax-theme':
      if (!isSyntaxThemeId(value)) return null;
      next.syntaxTheme = value;
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
