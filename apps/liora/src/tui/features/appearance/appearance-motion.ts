import { stripAnsiControls } from '#/tui/renderer';
import type { AppearancePreferences } from '#/tui/config';
import type { ColorToken } from '#/tui/theme';
import { currentTheme } from '#/tui/theme';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  motionEffectsAllowed,
  motionProgress,
  resolveQualityAdjustedAmbientEffectMode,
} from '#/tui/features/appearance/appearance-state';
import {
  renderPremiumHeadline,
  renderSpectacularText,
} from '#/tui/features/appearance/appearance-gradient';
import { renderParticleRail } from '#/tui/features/appearance/appearance-particles';
import { renderPulseText } from '#/tui/features/appearance/appearance-pulse';
import { renderShimmerPrefix } from '#/tui/features/appearance/appearance-shimmer';

export type MotionToolPhase = 'running' | 'streaming' | 'done' | 'error';

export const SETTLE_FLASH_MS = 420;
export const CROSSFADE_MS = 480;
export const ENTER_BEAT_MS = 720;
export const EXIT_BEAT_MS = 640;
export const TYPEWRITER_MS = 900;
export const TYPEWRITER_CURSOR = '▌';

/** Enter-beat TTL matching `renderEnterBeat` (subtle stretches ×1.2). */
export function enterBeatDurationMs(
  appearance: AppearancePreferences = getActiveAppearancePreferences(),
): number {
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  return mode === 'subtle' ? ENTER_BEAT_MS * 1.2 : ENTER_BEAT_MS;
}

/** Exit-beat TTL matching `renderExitBeat` (subtle stretches ×1.2). */
export function exitBeatDurationMs(
  appearance: AppearancePreferences = getActiveAppearancePreferences(),
): number {
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  return mode === 'subtle' ? EXIT_BEAT_MS * 1.2 : EXIT_BEAT_MS;
}

export function renderSettleFlash(
  text: string,
  seed: string,
  startedAtMs: number,
  appearance: AppearancePreferences = getActiveAppearancePreferences(),
): string {
  const plain = stripAnsiControls(text);
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  if (!motionEffectsAllowed() || mode === 'off') {
    return currentTheme.boldFg('textStrong', plain);
  }
  const p = motionProgress(startedAtMs, mode === 'subtle' ? SETTLE_FLASH_MS * 1.4 : SETTLE_FLASH_MS);
  if (p >= 1) return currentTheme.fg('text', plain);
  // ≥4 visual steps via spectacular → pulse → text
  if (p < 0.35) return renderSpectacularText(plain, seed, appearance, { intense: true, pace: 'fast' });
  if (p < 0.7) return renderPulseText(plain, seed, 'primary', appearance);
  return currentTheme.boldFg('primary', plain);
}

/** True while `renderToneSettleFlash` is still animating at this clock. */
export function isToneSettleFlashActive(
  startedAtMs: number,
  appearance: AppearancePreferences = getActiveAppearancePreferences(),
  nowMs: number = appearanceAnimationNow(),
): boolean {
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  if (!motionEffectsAllowed() || mode === 'off') return false;
  const duration = mode === 'subtle' ? SETTLE_FLASH_MS * 1.4 : SETTLE_FLASH_MS;
  return nowMs - startedAtMs < duration;
}

/**
 * Tone-preserving settle flash: same spectacular → pulse → bold stages as
 * `renderSettleFlash`, but the resting color is the given theme tone
 * (success/error/warning/…) instead of plain text — the mark's meaning
 * survives the flash. Off profile returns the static tone-colored text.
 */
export function renderToneSettleFlash(
  text: string,
  seed: string,
  startedAtMs: number,
  tone: ColorToken,
  appearance: AppearancePreferences = getActiveAppearancePreferences(),
): string {
  const plain = stripAnsiControls(text);
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  if (!motionEffectsAllowed() || mode === 'off') {
    return currentTheme.fg(tone, plain);
  }
  const p = motionProgress(startedAtMs, mode === 'subtle' ? SETTLE_FLASH_MS * 1.4 : SETTLE_FLASH_MS);
  if (p >= 1) return currentTheme.fg(tone, plain);
  // ≥4 visual steps via spectacular → pulse → bold tone → tone
  if (p < 0.35) {
    return renderSpectacularText(plain, seed, appearance, {
      intense: mode === 'premium',
      pace: 'fast',
    });
  }
  if (p < 0.7) return renderPulseText(plain, seed, tone, appearance);
  return currentTheme.boldFg(tone, plain);
}

/** Full enter→exit emphasis window for transient status lines. */
export const STATUS_FLASH_MS = 1600;

/** Status flash TTL (0 when motion is off; subtle stretches ×1.2). */
export function statusFlashDurationMs(
  appearance: AppearancePreferences = getActiveAppearancePreferences(),
): number {
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  if (!motionEffectsAllowed() || mode === 'off') return 0;
  return mode === 'subtle' ? STATUS_FLASH_MS * 1.2 : STATUS_FLASH_MS;
}

/** True while `renderStatusFlashLine` is still inside its emphasis window. */
export function isStatusFlashActive(
  startedAtMs: number,
  appearance: AppearancePreferences = getActiveAppearancePreferences(),
  nowMs: number = appearanceAnimationNow(),
): boolean {
  const duration = statusFlashDurationMs(appearance);
  return duration > 0 && nowMs - startedAtMs < duration;
}

/**
 * Enter/exit emphasis for transient status lines (session errors/warnings,
 * slash-command feedback): spectacular flash → pulse → bold tone → shimmer
 * hold → dimmed shimmer fade-out → static tone. Settles to byte-stable
 * tone-colored text once the window expires or when motion is off, so the
 * transcript line stays calm after the message has landed.
 */
export function renderStatusFlashLine(
  text: string,
  seed: string,
  startedAtMs: number,
  tone: ColorToken = 'textDim',
  appearance: AppearancePreferences = getActiveAppearancePreferences(),
): string {
  const plain = stripAnsiControls(text);
  const duration = statusFlashDurationMs(appearance);
  if (duration <= 0 || plain.length === 0) {
    return currentTheme.fg(tone, plain);
  }
  const p = motionProgress(startedAtMs, duration);
  if (p >= 1) return currentTheme.fg(tone, plain);
  // ≥5 visual steps: spectacular → pulse → bold → shimmer → dimmed fade-out
  if (p < 0.25) {
    return renderSpectacularText(plain, seed, appearance, {
      intense: true,
      pace: 'fast',
    });
  }
  if (p < 0.45) {
    return renderPulseText(
      plain,
      seed,
      tone === 'error' || tone === 'warning' ? tone : 'primary',
      appearance,
    );
  }
  if (p < 0.65) return currentTheme.boldFg(tone, plain);
  if (p < 0.85) return `${renderShimmerPrefix(appearance)}${currentTheme.fg(tone, plain)}`;
  return `${currentTheme.dim(renderShimmerPrefix(appearance))}${currentTheme.dimFg(tone, plain)}`;
}

export function renderPhaseChip(
  label: string,
  phase: MotionToolPhase,
  seed: string,
  appearance: AppearancePreferences = getActiveAppearancePreferences(),
): string {
  const plain = stripAnsiControls(label);
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  const mark =
    phase === 'running' ? '▸' : phase === 'streaming' ? '▹' : phase === 'done' ? '✓' : '!';
  // Use SELECT-safe marks that are NOT list pointers; these are chip glyphs only.
  const body = `${mark} ${plain}`;
  if (!motionEffectsAllowed() || mode === 'off') {
    const token =
      phase === 'error' ? 'error' : phase === 'done' ? 'glow' : 'textMuted';
    return currentTheme.fg(token, body);
  }
  if (phase === 'running' || phase === 'streaming') {
    return renderPulseText(body, `${seed}:${phase}`, phase === 'streaming' ? 'accent' : 'primary', appearance);
  }
  if (phase === 'error') return currentTheme.boldFg('error', body);
  // Done chip stays on brand glow — not the shared mint success token.
  return currentTheme.fg('glow', body);
}

export function renderCrossfadeLine(
  fromText: string,
  toText: string,
  seed: string,
  startedAtMs: number,
  appearance: AppearancePreferences = getActiveAppearancePreferences(),
): string {
  const from = stripAnsiControls(fromText);
  const to = stripAnsiControls(toText);
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  if (!motionEffectsAllowed() || mode === 'off' || from === to) {
    return currentTheme.fg('textMuted', to);
  }
  const p = motionProgress(startedAtMs, mode === 'subtle' ? CROSSFADE_MS * 1.4 : CROSSFADE_MS);
  if (p < 0.45) return currentTheme.dimFg('textMuted', from);
  if (p < 0.7) return renderShimmerPrefix(appearance) + currentTheme.fg('textMuted', to);
  return currentTheme.fg('textMuted', to);
}

/**
 * Reveal `text` left-to-right like a typewriter with a blinking brand cursor
 * while typing, settling to the full muted line once complete. Returns the
 * static full text when ambient motion is off (reduced-motion / low-color /
 * `profile: 'off'`), so callers never need a separate fallback branch.
 */
export function renderTypewriterLine(
  text: string,
  startedAtMs: number,
  appearance: AppearancePreferences = getActiveAppearancePreferences(),
): string {
  const plain = stripAnsiControls(text);
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  if (!motionEffectsAllowed() || mode === 'off' || plain.length === 0) {
    return currentTheme.fg('textMuted', plain);
  }
  const chars = Array.from(plain);
  const duration = mode === 'subtle' ? TYPEWRITER_MS * 1.3 : TYPEWRITER_MS;
  const p = motionProgress(startedAtMs, duration);
  const revealed = Math.max(1, Math.round(chars.length * p));
  if (p >= 1 || revealed >= chars.length) {
    return currentTheme.fg('textMuted', plain);
  }
  const body = chars.slice(0, revealed).join('');
  // Blink the cursor roughly twice per second while typing.
  const blinkOn = Math.floor(appearanceAnimationNow() / 260) % 2 === 0;
  const cursor = blinkOn ? currentTheme.fg('accent', TYPEWRITER_CURSOR) : '';
  return currentTheme.fg('textMuted', body) + cursor;
}

export function renderEnterBeat(
  title: string,
  width: number,
  seed: string,
  startedAtMs: number,
  appearance: AppearancePreferences = getActiveAppearancePreferences(),
): string[] {
  const plain = stripAnsiControls(title);
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  const w = Math.max(8, width);
  // Narrow terminals: keep a single title line (no rail / extra chrome height).
  const tiny = width < 40;
  if (!motionEffectsAllowed() || mode === 'off') {
    return [currentTheme.boldFg('textStrong', plain)];
  }
  const p = motionProgress(startedAtMs, enterBeatDurationMs(appearance));
  const head =
    p < 0.85
      ? renderPremiumHeadline(plain, `${seed}:title`, appearance)
      : currentTheme.boldFg('textStrong', plain);
  if (tiny) return [head];
  const rail = renderParticleRail(w, appearance, `${seed}:enter`);
  if (p < 0.25) return [currentTheme.dim(rail)];
  if (p < 0.5) return [currentTheme.dim(rail), head];
  if (p < 0.85) return [head, currentTheme.dim(rail)];
  return [head];
}

export function renderExitBeat(
  title: string,
  width: number,
  seed: string,
  startedAtMs: number,
  appearance: AppearancePreferences = getActiveAppearancePreferences(),
): string[] {
  // Mirror enter with brand glow, then collapse to a single line
  const plain = stripAnsiControls(title);
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  const w = Math.max(8, width);
  const tiny = width < 40;
  if (!motionEffectsAllowed() || mode === 'off') {
    return [currentTheme.fg('glow', plain)];
  }
  const p = motionProgress(startedAtMs, exitBeatDurationMs(appearance));
  const head = renderPulseText(plain, `${seed}:exit-title`, 'glow', appearance);
  if (tiny) {
    if (p < 0.65) return [head];
    return [currentTheme.fg('glow', plain)];
  }
  const rail = renderParticleRail(w, appearance, `${seed}:exit`);
  if (p < 0.3) return [head, currentTheme.dim(rail)];
  if (p < 0.65) return [head];
  return [currentTheme.fg('glow', plain)];
}

export function renderDangerBreathe(
  text: string,
  seed: string,
  appearance: AppearancePreferences = getActiveAppearancePreferences(),
): string {
  const plain = stripAnsiControls(text);
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  if (!motionEffectsAllowed() || mode === 'off') {
    return currentTheme.boldFg('error', plain);
  }
  // Alternate error / primary — stay on brand+danger, never warning yellow
  const interval = mode === 'premium' ? 220 : 400;
  const tick = Math.floor(appearanceAnimationNow() / interval) % 4;
  const token = tick % 2 === 0 ? 'error' : 'primary';
  return currentTheme.boldFg(token, plain);
}
