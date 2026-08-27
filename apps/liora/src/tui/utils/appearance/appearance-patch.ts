/**
 * Pure appearance preference patch parser — shared by /appearance persist
 * and Settings highlight-preview (no host / disk I/O).
 */

import type { AppearancePreferences } from '#/tui/config';
import { isTranscriptDetailLevel } from '#/tui/features/transcript/transcript-density';
import { isSyntaxThemeId } from '#/tui/theme/syntax-theme';

export function parseAppearancePatch(
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
    case 'mission-control':
    case 'worker-dock':
      if (!isOneOf(value, ['auto', 'pinned', 'hidden'])) return null;
      next.workerDock = value;
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
