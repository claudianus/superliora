/**
 * Intelligent empty-transcript stage.
 *
 * After the cinematic splash, the transcript is just Welcome + empty space.
 * This component fills that void with a viewport-filling Blood Moon night sky
 * (starfield, large moon, meteor rain, horizon rail) plus mood/tip chrome —
 * then vanishes the moment real transcript content arrives.
 *
 * Motion reuses the process-wide appearance animation clock (no private
 * scheduler). Gates match splash/welcome ambient effects.
 */

import type { Component } from '#/tui/renderer';
import { truncateToWidth } from '#/tui/renderer';
import chalk from 'chalk';

import {
  DEFAULT_APPEARANCE_PREFERENCES,
  type AppearancePreferences,
} from '#/tui/config';
import { ALL_TIPS } from '#/tui/constant/tips';
import type { AppState } from '#/tui/types';
import { currentTheme } from '#/tui/theme';
import {
  appearanceAnimationNow,
  renderMeteorField,
  renderParticleRail,
  renderSpectacularText,
  resolveQualityAdjustedAmbientEffectMode,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';
import {
  blitCentered,
  centerText,
  padOrTrim,
  paintStarfield,
  resolveMoonGlyphRows,
  stripAnsi,
} from '#/tui/utils/night-sky';
import { ttui } from '#/tui/utils/tui-i18n';

const IDLE_TIP_ROTATE_MS = 7_200;
const IDLE_LINE_ROTATE_MS = 4_800;

/** Soft floor so a large moon + rails still fit; no hard ceiling. */
const IDLE_STAGE_MIN_ROWS = 10;
/** Default when mount does not pass transcriptRows. */
const IDLE_STAGE_DEFAULT_ROWS = 12;

/** Mood lines under the moon — short, non-hype, product-flavored. */
const IDLE_MOOD_KEYS = [
  'tui.idle.mood.orbit',
  'tui.idle.mood.listen',
  'tui.idle.mood.ready',
  'tui.idle.mood.night',
  'tui.idle.mood.spark',
] as const;

export interface IdleStageOptions {
  readonly state: AppState;
  /**
   * Preferred stage height in rows (typically transcriptRows from the
   * region layout). Clamped only for tiny widths; no absolute row cap.
   */
  readonly preferredRows?: number;
  /**
   * Live transcript row budget (preferred). When set, re-measured each
   * render so resize fills the viewport; preferredRows is the fallback.
   */
  readonly getPreferredRows?: (width: number) => number;
}

/**
 * True when a transcript child is pure empty-state chrome (welcome, promo
 * banner, or this idle stage) and must not dismiss the ambient scene.
 */
export function isEmptyTranscriptChrome(component: Component): boolean {
  if (component instanceof IdleStageComponent) return true;
  // Constructor-name check avoids circular imports with welcome/banner modules.
  const name = component.constructor?.name;
  return name === 'WelcomeComponent' || name === 'BannerComponent';
}

/**
 * Resolve how many rows the idle stage should paint.
 *
 * Width gates keep the scene off micro terminals. There is no 14-row
 * ceiling — preferredRows (mount-time transcript budget) is the target.
 */
export function resolveIdleStageRows(width: number, preferredRows = IDLE_STAGE_DEFAULT_ROWS): number {
  const safeWidth = Math.max(0, Math.trunc(width));
  const preferred = Math.max(0, Math.trunc(preferredRows));
  if (safeWidth < 24) return 0;
  // Narrow stages cannot host a multi-layer moon — cap for readability.
  if (safeWidth < 40) return Math.min(preferred > 0 ? preferred : 7, 7);
  // Medium+: fill the requested transcript budget (no absolute row ceiling).
  const target = preferred > 0 ? preferred : IDLE_STAGE_DEFAULT_ROWS;
  const minRows = safeWidth < 60 ? 8 : IDLE_STAGE_MIN_ROWS;
  return Math.max(minRows, target);
}

export function resolveIdleMoodKey(nowMs: number): (typeof IDLE_MOOD_KEYS)[number] {
  const index = Math.floor(nowMs / IDLE_LINE_ROTATE_MS) % IDLE_MOOD_KEYS.length;
  return IDLE_MOOD_KEYS[index] ?? IDLE_MOOD_KEYS[0]!;
}

export function resolveIdleTipKey(nowMs: number): string | undefined {
  if (ALL_TIPS.length === 0) return undefined;
  const index = Math.floor(nowMs / IDLE_TIP_ROTATE_MS) % ALL_TIPS.length;
  return ALL_TIPS[index]?.key;
}

/**
 * Build the pure-text idle canvas (no outer chrome). Used by the component
 * and unit tests. Always pads/trims to exactly `targetRows` when non-zero.
 */
export function renderIdleStageLines(
  width: number,
  appearance: AppearancePreferences,
  options?: {
    readonly nowMs?: number;
    readonly preferredRows?: number;
    readonly workDir?: string;
  },
): string[] {
  const safeWidth = Math.max(0, Math.trunc(width));
  const targetRows = resolveIdleStageRows(safeWidth, options?.preferredRows ?? IDLE_STAGE_DEFAULT_ROWS);
  if (targetRows === 0 || safeWidth === 0) return [];

  const now = options?.nowMs ?? appearanceAnimationNow();
  const showAmbient =
    shouldRenderAmbientEffects(appearance) &&
    resolveQualityAdjustedAmbientEffectMode(appearance) !== 'off';
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  const premium = mode === 'premium';

  const palette = currentTheme.palette;
  const paint = (hex: string, text: string): string => chalk.hex(hex)(text);

  // Full-height plain canvas — pad-to-target is the height contract.
  const canvas: string[] = Array.from({ length: targetRows }, () => ' '.repeat(safeWidth));

  // --- Layer 1: starfield ---
  if (showAmbient) {
    const density = premium ? 0.14 : 0.1;
    paintStarfield(canvas, safeWidth, targetRows, now, density, (glyph, intensity) => {
      const hex =
        intensity > 0.7 ? palette.glow : intensity > 0.4 ? palette.particle : palette.textMuted;
      return paint(hex, glyph);
    });
  }

  // --- Layer 2: meteor rain (upper third) ---
  if (showAmbient && targetRows >= 8) {
    const meteorRows = Math.max(3, Math.floor(targetRows * 0.32));
    const field = renderMeteorField(safeWidth, meteorRows, 'idle:sky', appearance);
    const top = Math.max(0, Math.floor(targetRows * 0.06));
    for (let i = 0; i < field.length && top + i < targetRows; i++) {
      const line = field[i];
      if (line === undefined || stripAnsi(line).trim().length === 0) continue;
      // Only replace mostly-empty sky so stars remain where meteors are sparse.
      const existing = stripAnsi(canvas[top + i] ?? '');
      if (existing.replaceAll(' ', '').length > safeWidth * 0.35) continue;
      canvas[top + i] = padOrTrim(line, safeWidth);
    }
  }

  // Reserve bottom chrome band (title / mood / tip / dir / rails).
  const chromeBudget = resolveChromeBudget(targetRows, options?.workDir, safeWidth);
  const skyBudget = Math.max(5, targetRows - chromeBudget);

  // --- Layer 3: large / compact moon (Blood Moon, ≥5 rows when space allows) ---
  const moon = resolveMoonGlyphRows(safeWidth, skyBudget);
  const moonHex = premium ? palette.glow : palette.primary;
  const moonLines = moon.map((line) =>
    showAmbient ? paint(moonHex, line) : paint(palette.textDim, line),
  );
  // Rest near upper-mid sky so horizon + chrome still fit below.
  const moonTop = Math.max(1, Math.min(
    Math.floor(skyBudget * 0.18),
    skyBudget - moon.length - 1,
  ));
  blitCentered(canvas, moonLines, moonTop, safeWidth);

  if (showAmbient && moon.length >= 5) {
    const ringY = Math.min(targetRows - chromeBudget - 1, moonTop + moon.length);
    if (ringY > moonTop) {
      const ring = centerText(safeWidth, premium ? '˚ · ⋆ · ✦ · ⋆ · ˚' : '· ⋆ · ⋆ ·');
      canvas[ringY] = padOrTrim(paint(palette.particle, ring), safeWidth);
    }
  }

  // --- Layer 4: horizon rail ---
  const horizonY = Math.min(targetRows - chromeBudget, Math.max(moonTop + moon.length + 1, Math.floor(targetRows * 0.62)));
  if (horizonY >= 0 && horizonY < targetRows - 2) {
    const rail = showAmbient
      ? renderParticleRail(safeWidth, appearance, 'idle:horizon')
      : paint(palette.textMuted, '·'.repeat(Math.min(safeWidth, 24)).padEnd(safeWidth));
    canvas[horizonY] = padOrTrim(rail, safeWidth);
    if (horizonY + 1 < targetRows - chromeBudget + 2) {
      canvas[horizonY + 1] = padOrTrim(paint(palette.primary, '─'.repeat(safeWidth)), safeWidth);
    }
  }

  // --- Layer 5: bottom chrome (title, mood, tip, workdir) ---
  const title = showAmbient
    ? renderSpectacularText(ttui('tui.idle.title'), 'idle:title', appearance, {
        intense: premium,
        pace: 'slow',
      })
    : paint(palette.textDim, ttui('tui.idle.title'));

  const moodKey = resolveIdleMoodKey(now);
  const mood = ttui(moodKey);
  const tipKey = resolveIdleTipKey(now);
  const tip = tipKey === undefined ? '' : ttui(tipKey);
  const workDir = options?.workDir?.trim() ?? '';

  const chromeLines: string[] = [
    centerText(safeWidth, title),
    centerText(safeWidth, `${paint(moonHex, '●')}  ${paint(palette.textDim, mood)}`),
  ];
  if (tip.length > 0) {
    const prefix = ttui('tui.idle.tipPrefix');
    const tipBody = truncateToWidth(tip, Math.max(8, safeWidth - 8), '…');
    chromeLines.push(centerText(safeWidth, paint(palette.textMuted, `${prefix}${tipBody}`)));
  }
  if (workDir.length > 0 && safeWidth >= 40) {
    const dir = truncateToWidth(workDir, Math.max(12, safeWidth - 4), '…');
    chromeLines.push(centerText(safeWidth, paint(palette.textMuted, dir)));
  }

  // Place chrome at the bottom of the canvas (pad-to-target).
  let y = targetRows - chromeLines.length;
  if (y < 0) y = 0;
  for (let i = 0; i < chromeLines.length && y + i < targetRows; i++) {
    canvas[y + i] = padOrTrim(chromeLines[i]!, safeWidth);
  }

  // Enforce exact width + exact height contract.
  for (let i = 0; i < canvas.length; i++) {
    const line = canvas[i] ?? '';
    canvas[i] = stripAnsi(line).length === 0 && line.length === 0
      ? ' '.repeat(safeWidth)
      : padOrTrim(line, safeWidth);
  }

  // Absolute height contract: exactly targetRows.
  if (canvas.length > targetRows) return canvas.slice(0, targetRows);
  while (canvas.length < targetRows) {
    canvas.push(' '.repeat(safeWidth));
  }
  return canvas;
}

function resolveChromeBudget(targetRows: number, workDir: string | undefined, width: number): number {
  // title + mood + optional tip + optional dir + breathing room
  let budget = 3; // title, mood, spacer
  budget += 1; // tip almost always present
  if ((workDir?.trim().length ?? 0) > 0 && width >= 40) budget += 1;
  // Keep chrome from eating the moon on short stages.
  return Math.min(budget + 1, Math.max(3, Math.floor(targetRows * 0.35)));
}

export class IdleStageComponent implements Component {
  private readonly state: AppState;
  private readonly preferredRows: number;
  private readonly getPreferredRows: ((width: number) => number) | undefined;

  constructor(options: IdleStageOptions) {
    this.state = options.state;
    this.preferredRows = options.preferredRows ?? IDLE_STAGE_DEFAULT_ROWS;
    this.getPreferredRows = options.getPreferredRows;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const appearance = this.state.appearance ?? DEFAULT_APPEARANCE_PREFERENCES;
    const live = this.getPreferredRows?.(width);
    const preferredRows =
      live !== undefined && Number.isFinite(live) ? Math.trunc(live) : this.preferredRows;
    return renderIdleStageLines(width, appearance, {
      preferredRows,
      workDir: this.state.workDir,
    });
  }
}
