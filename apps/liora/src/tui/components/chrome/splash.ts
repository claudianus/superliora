/**
 * Full-screen cinematic startup splash.
 *
 * Owns the entire terminal for 1.0–2.0s when motion is allowed: starfield,
 * rising moon, meteor rain, horizon bloom, then SUPERLIORA brand reveal.
 * Skips immediately when shouldAnimate / motionEffectsAllowed is false.
 */

import chalk from 'chalk';

import {
  DEFAULT_APPEARANCE_PREFERENCES,
  type AppearancePreferences,
} from '#/tui/config';
import { shouldAnimate } from '#/tui/controllers/appearance';
import { resolveResponsiveLayout } from '#/tui/controllers/responsive-layout';
import type { Component } from '#/tui/renderer';
import { visibleWidth } from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import {
  advanceAppearanceAnimationClock,
  renderMeteorField,
  renderParticleRail,
  renderSpectacularText,
} from '#/tui/utils/appearance-effects';
import {
  blitCentered,
  centerText,
  MOON_COMPACT,
  MOON_LARGE,
  padOrTrim,
  paintStarfield,
} from '#/tui/utils/night-sky';
import { renderWelcomeBanner } from './welcome-banner';

/** Inclusive lower bound for splash duration. */
export const SPLASH_DURATION_MIN_MS = 1000;
/** Inclusive upper bound for splash duration. */
export const SPLASH_DURATION_MAX_MS = 2000;
/** Default cinematic length (~1.6s). */
export const DEFAULT_SPLASH_DURATION_MS = 1600;

export type SplashPhase = 'void' | 'rise' | 'bloom' | 'brand' | 'hold' | 'fade' | 'done';

export interface SplashComponentOptions {
  readonly appearance?: AppearancePreferences;
  readonly requestRender: () => void;
  /** Terminal row count (full-screen height). Defaults to process.stdout.rows. */
  readonly getRows?: () => number;
  /** Optional override duration (clamped to 1.0–2.0s). */
  readonly durationMs?: number;
  /**
   * Force play/skip. When omitted, uses shouldPlaySplash(appearance).
   * Tests use this for skip-matrix isolation.
   */
  readonly forcePlay?: boolean;
  /** Injected clock for tests (ms). */
  readonly now?: () => number;
  /**
   * Host hook: true while the cinematic is active so AppearanceController can
   * force the shared ambient schedule (splash has no private ticker).
   */
  readonly onSplashActiveChange?: (active: boolean) => void;
}

/**
 * Clamp splash duration into the allowed cinematic window.
 * Non-finite values fall back to the default length.
 */
export function clampSplashDurationMs(durationMs: number): number {
  if (!Number.isFinite(durationMs)) return DEFAULT_SPLASH_DURATION_MS;
  return Math.min(
    SPLASH_DURATION_MAX_MS,
    Math.max(SPLASH_DURATION_MIN_MS, Math.round(durationMs)),
  );
}

/** True when startup should run the animated splash. */
export function shouldPlaySplash(appearance: AppearancePreferences): boolean {
  return shouldAnimate(appearance);
}

/**
 * Map elapsed time to a cinematic phase.
 * Timeline fractions are relative to the clamped duration.
 */
export function resolveSplashPhase(elapsedMs: number, durationMs: number): SplashPhase {
  const duration = clampSplashDurationMs(durationMs);
  if (duration <= 0) return 'done';
  const t = Math.max(0, elapsedMs) / duration;
  if (t >= 1) return 'done';
  if (t < 0.1) return 'void';
  if (t < 0.32) return 'rise';
  if (t < 0.48) return 'bloom';
  if (t < 0.72) return 'brand';
  if (t < 0.9) return 'hold';
  return 'fade';
}

/** How many banner lines are revealed for the current phase progress. */
export function resolveBannerRevealCount(
  elapsedMs: number,
  durationMs: number,
  totalLines: number,
): number {
  if (totalLines <= 0) return 0;
  const phase = resolveSplashPhase(elapsedMs, durationMs);
  if (phase === 'void' || phase === 'rise' || phase === 'bloom') return 0;
  if (phase === 'done' || phase === 'hold' || phase === 'fade') return totalLines;
  // brand: progressive reveal
  const duration = clampSplashDurationMs(durationMs);
  const start = 0.48 * duration;
  const end = 0.72 * duration;
  const local = Math.min(1, Math.max(0, (elapsedMs - start) / Math.max(1, end - start)));
  return Math.max(1, Math.ceil(local * totalLines));
}

/** Progress of the moon rise within the rise+bloom window (0..1). */
export function resolveMoonRiseProgress(elapsedMs: number, durationMs: number): number {
  const duration = clampSplashDurationMs(durationMs);
  const start = 0.1 * duration;
  const end = 0.48 * duration;
  return Math.min(1, Math.max(0, (elapsedMs - start) / Math.max(1, end - start)));
}

/** Fade-out alpha in the final phase (1 → 0). */
export function resolveFadeAlpha(elapsedMs: number, durationMs: number): number {
  const phase = resolveSplashPhase(elapsedMs, durationMs);
  if (phase === 'done') return 0;
  if (phase !== 'fade') return 1;
  const duration = clampSplashDurationMs(durationMs);
  const start = 0.9 * duration;
  const local = Math.min(1, Math.max(0, (elapsedMs - start) / Math.max(1, duration - start)));
  return 1 - local;
}

export class SplashComponent implements Component {
  private readonly appearance: AppearancePreferences;
  private readonly requestRender: () => void;
  private readonly getRows: () => number;
  private readonly durationMs: number;
  private readonly forcePlay: boolean | undefined;
  private readonly nowFn: () => number;
  private readonly onSplashActiveChange: ((active: boolean) => void) | undefined;
  private startedAt = 0;
  private playResolve: (() => void) | undefined;
  private ambientForced = false;
  private finished = false;
  private disposed = false;

  constructor(options: SplashComponentOptions) {
    this.appearance = options.appearance ?? DEFAULT_APPEARANCE_PREFERENCES;
    this.requestRender = options.requestRender;
    this.getRows = options.getRows ?? (() => Math.max(12, process.stdout.rows ?? 24));
    this.durationMs = clampSplashDurationMs(
      options.durationMs ?? DEFAULT_SPLASH_DURATION_MS,
    );
    this.forcePlay = options.forcePlay;
    // Wall clock only. appearanceAnimationNow() is driven by the native frame
    // loop (performance.now) and freezes/regresses splash elapsed when mixed in.
    this.nowFn = options.now ?? (() => Date.now());
    this.onSplashActiveChange = options.onSplashActiveChange;
  }

  get phase(): SplashPhase {
    if (this.finished) return 'done';
    return resolveSplashPhase(this.elapsedMs, this.durationMs);
  }

  get elapsedMs(): number {
    return Math.max(0, this.nowFn() - this.startedAt);
  }

  get isFinished(): boolean {
    return this.finished;
  }

  /** Alias used by older tests / call sites. */
  get isDone(): boolean {
    return this.finished;
  }

  get clampedDurationMs(): number {
    return this.durationMs;
  }

  /** Active-theme primary hex — never a hard-coded palette. */
  get activePrimaryHex(): string {
    return currentTheme.palette.primary;
  }

  /** Alias for active theme primary. */
  get activePalettePrimary(): string {
    return currentTheme.palette.primary;
  }

  invalidate(): void {
    // Stateless frame; parent requests re-render on animation ticks.
  }

  /**
   * Start the splash. Resolves when duration elapses, force-skip is set,
   * or dispose() is called. Always safe to await.
   */
  play(): Promise<void> {
    if (this.disposed || this.finished) return Promise.resolve();

    const enabled =
      this.forcePlay !== undefined
        ? this.forcePlay
        : shouldPlaySplash(this.appearance);

    if (!enabled) {
      this.finished = true;
      return Promise.resolve();
    }

    this.startedAt = this.nowFn();
    advanceAppearanceAnimationClock(this.startedAt);
    this.setAmbientForced(true);

    return new Promise<void>((resolve) => {
      this.playResolve = resolve;
      // Kick first frame; ambient schedule + render() drive the rest.
      this.requestRender();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.finish();
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.setAmbientForced(false);
    const resolve = this.playResolve;
    this.playResolve = undefined;
    resolve?.();
  }

  private setAmbientForced(active: boolean): void {
    if (this.ambientForced === active) return;
    this.ambientForced = active;
    this.onSplashActiveChange?.(active);
  }

  /**
   * Advance ambient clock + wall-clock finish check on every host paint.
   * Elapsed duration stays on nowFn (not appearanceAnimationNow).
   */
  private tickWhilePlaying(): void {
    if (this.disposed || this.finished || this.playResolve === undefined) return;
    const now = this.nowFn();
    advanceAppearanceAnimationClock(now);
    if (now - this.startedAt >= this.durationMs) {
      this.finish();
    }
  }

  /**
   * Always paints exactly `getRows()` lines so the splash owns the full
   * terminal surface (not a short banner strip).
   */
  render(width: number): string[] {
    this.tickWhilePlaying();
    const safeWidth = Math.max(1, Math.floor(width));
    const rows = Math.max(8, Math.floor(this.getRows()));
    const appearance = this.appearance;
    const elapsed = this.elapsedMs;
    const phase = resolveSplashPhase(elapsed, this.durationMs);
    const fade = resolveFadeAlpha(elapsed, this.durationMs);
    const layout = resolveResponsiveLayout({ width: safeWidth, height: rows });
    const palette = currentTheme.palette;
    const primaryHex = palette.primary;
    const glowHex = palette.glow;
    const particleHex = palette.particle;
    const mutedHex = palette.textMuted;
    const paint = (hex: string, text: string): string => chalk.hex(hex)(text);
    const muted = (text: string): string => chalk.hex(mutedHex)(text);

    // Build full-height canvas of plain spaces, then paint layers.
    const canvas: string[] = Array.from({ length: rows }, () => ' '.repeat(safeWidth));

    // --- Layer 1: starfield (all phases except pure void early) ---
    const starDensity =
      phase === 'void'
        ? 0.02 + (elapsed / this.durationMs) * 0.08
        : phase === 'fade'
          ? 0.04 * fade
          : 0.12;
    paintStarfield(canvas, safeWidth, rows, elapsed, starDensity, (glyph, intensity) => {
      if (fade < 0.15) return ' ';
      const hex = intensity > 0.7 ? glowHex : intensity > 0.4 ? particleHex : mutedHex;
      return paint(hex, glyph);
    });

    // --- Layer 2: meteor rain (rise → hold) ---
    if (phase !== 'void' && phase !== 'done' && fade > 0.2) {
      const meteorRows = Math.max(3, Math.floor(rows * 0.35));
      const field = renderMeteorField(safeWidth, meteorRows, 'splash:sky', appearance);
      // Overlay near the top third
      const top = Math.max(0, Math.floor(rows * 0.08));
      for (let i = 0; i < field.length && top + i < rows; i++) {
        const line = field[i];
        if (line === undefined || line.trim().length === 0) continue;
        canvas[top + i] = padOrTrim(line, safeWidth);
      }
    }

    // --- Layer 3: rising moon ---
    const moonProgress = resolveMoonRiseProgress(elapsed, this.durationMs);
    if (moonProgress > 0 && phase !== 'done') {
      const moon = safeWidth >= 40 ? MOON_LARGE : MOON_COMPACT;
      const moonHex =
        phase === 'bloom' || phase === 'brand' || phase === 'hold' ? glowHex : primaryHex;
      const moonLines = moon.map((line) => {
        if (fade < 0.25) return paint(mutedHex, line);
        return paint(moonHex, line);
      });
      // Rise: start below center, end at ~28% from top
      const restingTop = Math.max(1, Math.floor(rows * 0.18));
      const startTop = rows - moon.length - 1;
      const moonTop = Math.round(startTop + (restingTop - startTop) * moonProgress);
      blitCentered(canvas, moonLines, moonTop, safeWidth);

      // Glow ring under moon during bloom+
      if (moonProgress > 0.6 && fade > 0.4) {
        const ringY = Math.min(rows - 1, moonTop + moon.length);
        const ring = centerText(safeWidth, '˚ · ⋆ · ✦ · ⋆ · ˚');
        canvas[ringY] = padOrTrim(paint(particleHex, ring), safeWidth);
      }
    }

    // --- Layer 4: horizon bloom ---
    if (
      phase === 'bloom' ||
      phase === 'brand' ||
      phase === 'hold' ||
      (phase === 'fade' && fade > 0.3)
    ) {
      const horizonY = Math.min(rows - 2, Math.floor(rows * 0.72));
      const rail = renderParticleRail(safeWidth, appearance, 'splash:horizon');
      canvas[horizonY] = padOrTrim(rail, safeWidth);
      if (horizonY + 1 < rows) {
        canvas[horizonY + 1] = padOrTrim(
          paint(primaryHex, '─'.repeat(safeWidth)),
          safeWidth,
        );
      }
    }

    // --- Layer 5: SUPERLIORA brand ---
    if (phase === 'brand' || phase === 'hold' || phase === 'fade') {
      const bannerAll = renderWelcomeBanner(layout, appearance, safeWidth);
      const reveal = resolveBannerRevealCount(elapsed, this.durationMs, bannerAll.length);
      const banner = bannerAll.slice(0, reveal);
      const brandTop = Math.max(
        1,
        Math.floor(rows * 0.42) - Math.floor(banner.length / 2),
      );
      blitCentered(canvas, banner, brandTop, safeWidth);

      if (reveal >= bannerAll.length && fade > 0.35) {
        const tagY = Math.min(rows - 1, brandTop + banner.length + 1);
        const tag = renderSpectacularText('SUPERLIORA', 'splash:tagline', appearance, {
          intense: true,
          pace: 'slow',
        });
        const sep = paint(glowHex, ' · ');
        const sub = muted('agent runtime');
        canvas[tagY] = padOrTrim(centerText(safeWidth, `${tag}${sep}${sub}`), safeWidth);
      }
    }

    // --- Layer 6: void vignette edges (top/bottom dim bars) ---
    if (phase === 'void' || phase === 'rise') {
      canvas[0] = padOrTrim(muted('▄'.repeat(safeWidth)), safeWidth);
      canvas[rows - 1] = padOrTrim(muted('▀'.repeat(safeWidth)), safeWidth);
    }

    // --- Layer 7: fade collapse — blank out edges as fade progresses ---
    if (phase === 'fade' && fade < 0.85) {
      const blankRows = Math.floor((1 - fade) * rows * 0.45);
      for (let i = 0; i < blankRows && i < rows; i++) {
        canvas[i] = ' '.repeat(safeWidth);
        canvas[rows - 1 - i] = ' '.repeat(safeWidth);
      }
    }

    // Ensure every line is exactly safeWidth (no ANSI-only empty collapse)
    for (let i = 0; i < canvas.length; i++) {
      const line = canvas[i] ?? '';
      if (visibleWidth(line) === 0) {
        // Plain spaces: region.background / inheritRegionBackground paints theme canvas.
        // Do not chalk-bg spaces here — that fought canvasBackground and flashed black.
        canvas[i] = ' '.repeat(safeWidth);
      } else {
        canvas[i] = padOrTrim(line, safeWidth);
      }
    }

    return canvas;
  }
}

