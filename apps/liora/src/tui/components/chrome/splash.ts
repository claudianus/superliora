/**
 * Startup cinematic splash: short full-width reveal before Welcome.
 * Plays once for 1.0–2.0s when motion is allowed; otherwise a no-op.
 */

import type { Component } from '#/tui/renderer';
import { truncateToWidth } from '#/tui/renderer';
import chalk from 'chalk';

import { DEFAULT_APPEARANCE_PREFERENCES, type AppearancePreferences } from '#/tui/config';
import { shouldAnimate } from '#/tui/controllers/appearance';
import { AnimationScheduler } from '#/tui/controllers/animation-scheduler';
import { resolveResponsiveLayout } from '#/tui/controllers/responsive-layout';
import { currentTheme } from '#/tui/theme';
import {
  advanceAppearanceAnimationClock,
  renderMeteorField,
  renderParticleRail,
  renderSpectacularText,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';
import { renderWelcomeBanner } from './welcome-banner';

/** Inclusive lower bound for splash duration. */
export const SPLASH_DURATION_MIN_MS = 1000;
/** Inclusive upper bound for splash duration. */
export const SPLASH_DURATION_MAX_MS = 2000;
/** Default cinematic length (within clamp). */
export const DEFAULT_SPLASH_DURATION_MS = 1600;

export type SplashPhase = 'void' | 'meteor' | 'banner' | 'hold' | 'done';

export interface SplashComponentOptions {
  readonly appearance?: AppearancePreferences;
  readonly requestRender: () => void;
  /** Desired duration; clamped to [1000, 2000]. */
  readonly durationMs?: number;
  /** Clock for elapsed time (tests inject fake timers). */
  readonly now?: () => number;
  /**
   * Force play/skip. When omitted, uses shouldPlaySplash(appearance).
   * Tests use this for skip-matrix isolation.
   */
  readonly forcePlay?: boolean;
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
  if (t < 0.12) return 'void';
  if (t < 0.38) return 'meteor';
  if (t < 0.72) return 'banner';
  return 'hold';
}

/** How many banner lines are revealed for the current phase progress. */
export function resolveBannerRevealCount(
  elapsedMs: number,
  durationMs: number,
  totalLines: number,
): number {
  if (totalLines <= 0) return 0;
  const phase = resolveSplashPhase(elapsedMs, durationMs);
  if (phase === 'void' || phase === 'done') return phase === 'done' ? totalLines : 0;
  if (phase === 'meteor') {
    const duration = clampSplashDurationMs(durationMs);
    const start = 0.12 * duration;
    const end = 0.38 * duration;
    const local = Math.min(1, Math.max(0, (elapsedMs - start) / Math.max(1, end - start)));
    return Math.max(1, Math.ceil(local * totalLines));
  }
  return totalLines;
}

export class SplashComponent implements Component {
  private readonly appearance: AppearancePreferences;
  private readonly requestRender: () => void;
  private readonly durationMs: number;
  private readonly now: () => number;
  private readonly forcePlay: boolean | undefined;
  private scheduler: AnimationScheduler | undefined;
  private startedAt = 0;
  private elapsedMs = 0;
  private done = false;
  private resolvePlay: (() => void) | undefined;

  constructor(options: SplashComponentOptions) {
    this.appearance = options.appearance ?? DEFAULT_APPEARANCE_PREFERENCES;
    this.requestRender = options.requestRender;
    this.durationMs = clampSplashDurationMs(
      options.durationMs ?? DEFAULT_SPLASH_DURATION_MS,
    );
    this.now = options.now ?? (() => Date.now());
    this.forcePlay = options.forcePlay;
  }

  /** Active-theme primary hex — never a hard-coded palette. */
  get activePalettePrimary(): string {
    return currentTheme.palette.primary;
  }

  get phase(): SplashPhase {
    if (this.done) return 'done';
    return resolveSplashPhase(this.elapsedMs, this.durationMs);
  }

  get isDone(): boolean {
    return this.done;
  }

  get clampedDurationMs(): number {
    return this.durationMs;
  }

  invalidate(): void {}

  /**
   * Run the splash until duration elapses (or immediately when skipped).
   * Safe to call once; subsequent calls resolve immediately.
   */
  play(): Promise<void> {
    if (this.done) return Promise.resolve();

    const play =
      this.forcePlay !== undefined
        ? this.forcePlay
        : shouldPlaySplash(this.appearance);

    if (!play) {
      this.markDone();
      return Promise.resolve();
    }

    this.startedAt = this.now();
    this.elapsedMs = 0;
    advanceAppearanceAnimationClock(this.startedAt);

    return new Promise<void>((resolve) => {
      this.resolvePlay = resolve;
      this.scheduler = new AnimationScheduler({
        fps: Math.max(12, this.appearance.animationFps || 20),
        enabled: true,
        requestRender: () => {
          this.tick();
          this.requestRender();
        },
        shouldRender: () => !this.done,
        beforeRender: () => {
          advanceAppearanceAnimationClock(this.now());
        },
      });
      // First paint immediately so the void/meteor frame is not delayed one tick.
      this.tick();
      this.requestRender();
    });
  }

  dispose(): void {
    this.scheduler?.dispose();
    this.scheduler = undefined;
    if (!this.done) this.markDone();
  }

  render(width: number): string[] {
    const safeWidth = Math.max(0, width);
    if (safeWidth === 0 || this.done) return [];

    const appearance = this.appearance;
    const layout = resolveResponsiveLayout({ width: safeWidth });
    const phase = this.phase;
    const primaryHex = currentTheme.palette.primary;
    const dimHex = currentTheme.palette.textDim;
    const glowHex = currentTheme.palette.glow;
    const primary = (s: string): string => chalk.hex(primaryHex)(s);
    const dim = (s: string): string => chalk.hex(dimHex)(s);

    if (phase === 'void') {
      const rail = shouldRenderAmbientEffects(appearance)
        ? renderParticleRail(safeWidth, appearance, 'splash:void-rail')
        : ' '.repeat(safeWidth);
      return ['', dim(truncateToWidth(rail, safeWidth, '…')), ''];
    }

    const bannerAll = renderWelcomeBanner(layout, appearance, safeWidth);
    const reveal = resolveBannerRevealCount(this.elapsedMs, this.durationMs, bannerAll.length);
    const bannerLines = bannerAll.slice(0, reveal).map((line, index) => {
      // Banner already applies spectacular paint; re-paint hold phase with theme glow accent.
      if (phase === 'hold' && index === 0) {
        return renderSpectacularText(
          stripLeadingAnsiKeepWidth(line, safeWidth),
          `splash:banner:${String(index)}`,
          appearance,
          { rowIndex: index, intense: true },
        );
      }
      return truncateToWidth(line, safeWidth, '…');
    });

    const lines: string[] = [''];

    if (phase === 'meteor' || phase === 'banner' || phase === 'hold') {
      const meteorRows =
        shouldRenderAmbientEffects(appearance) && safeWidth >= 24
          ? Math.min(4, Math.max(2, Math.floor(safeWidth / 28)))
          : 0;
      if (meteorRows > 0) {
        const field = renderMeteorField(
          safeWidth,
          meteorRows,
          'splash:meteors',
          appearance,
        );
        lines.push(...field.map((row) => truncateToWidth(row, safeWidth, '…')));
        lines.push('');
      }
    }

    if (bannerLines.length > 0) {
      lines.push(...bannerLines);
      lines.push('');
    }

    if (phase === 'banner' || phase === 'hold') {
      const tag = renderSpectacularText('SUPERLIORA', 'splash:tagline', appearance, {
        intense: true,
        pace: 'fast',
      });
      // Theme glow accent — active palette, not a fixed Blood Moon hex.
      const accent = chalk.hex(glowHex)(' · ');
      const tagline = truncateToWidth(`${tag}${accent}${dim('boot')}`, safeWidth, '…');
      lines.push(tagline);
      lines.push(
        truncateToWidth(
          renderParticleRail(safeWidth, appearance, 'splash:hold-rail'),
          safeWidth,
          '…',
        ),
      );
    }

    // Palette-token marker so tests can assert the active theme primary hex.
    lines.push(primary('◆'));
    lines.push('');
    return lines;
  }

  private tick(): void {
    if (this.done) return;
    const now = this.now();
    this.elapsedMs = Math.max(0, now - this.startedAt);
    advanceAppearanceAnimationClock(now);
    if (this.elapsedMs >= this.durationMs) {
      this.markDone();
    }
  }

  private markDone(): void {
    if (this.done) return;
    this.done = true;
    this.elapsedMs = this.durationMs;
    this.scheduler?.dispose();
    this.scheduler = undefined;
    const resolve = this.resolvePlay;
    this.resolvePlay = undefined;
    resolve?.();
  }
}

/** Best-effort strip of SGR for re-paint; keeps display width via truncation later. */
function stripLeadingAnsiKeepWidth(text: string, maxWidth: number): string {
  const plain = text.replaceAll(/\u001B\[[0-9;]*m/g, '');
  return truncateToWidth(plain, maxWidth, '…');
}
