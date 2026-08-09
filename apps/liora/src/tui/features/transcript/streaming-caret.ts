/**
 * Kinetic streaming caret shared by assistant + thinking live drafts.
 * Soft sine breath on the shared animation clock — no hard on/off blink.
 */

import { currentTheme } from '#/tui/theme';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  motionEffectsAllowed,
  resolveQualityAdjustedAmbientEffectMode,
} from '#/tui/features/appearance/appearance-effects';

/** Kinetic caret — block + dual spark trail so catch-up is impossible to miss. */
const STREAMING_CARET = '▌';
/** Soft sine period — shorter than 220ms so the tip breathes at ~premium cadence. */
const CARET_PULSE_INTERVAL_MS = 160;
const CARET_TRAIL = ['·', '˙', '˚', '•'] as const;
const CARET_TRAIL_OUTER = ['˙', '·', '˚'] as const;

/** Whether the streaming caret should render in the current environment. */
export function streamingCaretActive(): boolean {
  if (!motionEffectsAllowed()) return false;
  return resolveQualityAdjustedAmbientEffectMode(getActiveAppearancePreferences()) !== 'off';
}

/**
 * Append a pulsing caret (+ dual micro trail) to the last non-empty content line.
 * Smooth sine breath on the shared animation clock — no hard on/off threshold.
 */
export function appendStreamingCaret(
  lines: readonly string[],
  _contentWidth?: number,
): readonly string[] {
  if (lines.length === 0) return lines;
  let lastIndex = lines.length - 1;
  while (lastIndex > 0 && lines[lastIndex]!.trim().length === 0) {
    lastIndex--;
  }
  const now = appearanceAnimationNow();
  // Continuous breath 0→1→0; avoid a hard threshold that flickered bold/regular.
  const phase = (Math.sin((now / CARET_PULSE_INTERVAL_MS) * Math.PI * 2) + 1) / 2;
  const hot = phase > 0.55;
  const warm = phase > 0.28;
  const caret = currentTheme.boldFg(
    hot ? 'glow' : warm ? 'gradientStart' : 'primary',
    STREAMING_CARET,
  );
  const trailGlyph = CARET_TRAIL[Math.floor(now / 40) % CARET_TRAIL.length] ?? '·';
  const outerGlyph = CARET_TRAIL_OUTER[Math.floor(now / 55) % CARET_TRAIL_OUTER.length] ?? '˙';
  const trail = currentTheme.fg(hot ? 'primary' : warm ? 'particle' : 'textDim', trailGlyph);
  const outer = currentTheme.fg(hot ? 'glow' : warm ? 'primary' : 'particle', outerGlyph);
  const next = [...lines];
  next[lastIndex] = `${lines[lastIndex]}${outer}${trail}${caret}`;
  return next;
}
