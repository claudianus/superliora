/**
 * Intelligent empty-transcript stage.
 *
 * After the cinematic splash, the transcript is just Welcome + empty space.
 * This component fills that void with a self-contained story scene —
 * "Jewel Tank" (lead fish, seaweed curtain, coral, air-stone, caustics) —
 * then vanishes the moment real transcript content arrives.
 *
 * Visual language is intentionally distinct from the Blood Moon splash
 * (no shared moon glyphs / meteor field / splash starfield).
 *
 * Motion reuses the process-wide appearance animation clock (no private
 * scheduler). Gates match splash/welcome ambient effects.
 */

import type { Component } from '#/tui/renderer';
import { mixHexColor, styleToAnsi, truncateToWidth } from '#/tui/renderer';
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
  renderSpectacularText,
  resolveQualityAdjustedAmbientEffectMode,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';
import {
  centerText,
  padOrTrim,
  paintIdleStoryScene,
  resolveFishGlyphRows,
  stripAnsi,
} from '#/tui/utils/idle-scene';
import {
  createIdleTankSim,
  dropFood,
  resizeIdleTankSim,
  snapshotIdleTankSim,
  tickIdleTankSim,
  type IdleTankSim,
  type IdleTankSnapshot,
} from '#/tui/utils/idle-tank-sim';
import { ttui } from '#/tui/utils/tui-i18n';

const ANSI_RESET = '\u001B[0m';

const IDLE_TIP_ROTATE_MS = 7_200;
const IDLE_LINE_ROTATE_MS = 4_800;

/** Soft floor so tank + fish still fit; no hard ceiling. */
const IDLE_STAGE_MIN_ROWS = 10;
/** Default when mount does not pass transcriptRows. */
const IDLE_STAGE_DEFAULT_ROWS = 12;

/** Mood lines under the scene — short, calm, non-hype. */
const IDLE_MOOD_KEYS = [
  'tui.idle.mood.bubbles',
  'tui.idle.mood.swim',
  'tui.idle.mood.ready',
  'tui.idle.mood.tank',
  'tui.idle.mood.quiet',
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
  // Narrow stages cannot host multi-layer story art — cap for readability.
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
 * Pure render helper — used by the component and unit tests.
 * Height contract: exactly `resolveIdleStageRows(...)` lines, each ≤ width.
 */
export function renderIdleStageLines(
  width: number,
  appearance: AppearancePreferences,
  options?: {
    readonly nowMs?: number;
    readonly preferredRows?: number;
    readonly workDir?: string;
    readonly sim?: IdleTankSnapshot;
    readonly themeMode?: 'dark' | 'light';
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
  const premiumChrome = showAmbient && premium;

  const palette = currentTheme.palette;
  const paint = (hex: string, text: string): string => chalk.hex(hex)(text);

  // Full-height plain canvas — pad-to-target is the height contract.
  const canvas: string[] = Array.from({ length: targetRows }, () => ' '.repeat(safeWidth));

  // Reserve bottom chrome band (title / mood / tip / dir).
  const chromeBudget = resolveChromeBudget(targetRows, options?.workDir, safeWidth, premiumChrome);
  const storyRows = Math.max(5, targetRows - chromeBudget);

  // Story scene: Jewel Tank layers (water → plants → fish).
  paintIdleStoryScene({
    canvas,
    width: safeWidth,
    storyRows,
    elapsedMs: now,
    showAmbient,
    premium,
    paint,
    colors: {
      glow: palette.glow,
      particle: palette.particle,
      primary: palette.primary,
      accent: palette.accent,
      textDim: palette.textDim,
      textMuted: palette.textMuted,
      gradientStart: palette.gradientStart,
      gradientEnd: palette.gradientEnd,
      roleUser: palette.roleUser,
      shellMode: palette.shellMode,
      success: palette.success,
      surfaceSunken: palette.surfaceSunken,
    },
    themeMode: options?.themeMode,
    sim: options?.sim,
  });

  // --- Bottom chrome (title, mood, tip, workdir) ---
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
  const fishHex = premium ? palette.glow : palette.primary;
  const themeMode = options?.themeMode ?? 'dark';

  const chromeLines: string[] = [];
  chromeLines.push(
    centerText(safeWidth, title),
    centerText(safeWidth, `${paint(fishHex, '><>')}  ${paint(palette.textDim, mood)}`),
  );
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
  // Fill story→chrome breathing room with abyss water — bare canvas spaces here
  // read as solid near-black bands between the tank and the title.
  if (showAmbient && y > storyRows) {
    const abyss =
      themeMode === 'light'
        ? mixHexColor(palette.surfaceSunken, palette.primary, 0.12)
        : mixHexColor(palette.surfaceSunken, '#0A1420', 0.55);
    const gap = `${styleToAnsi({ bg: abyss })}${' '.repeat(safeWidth)}${ANSI_RESET}`;
    for (let gapY = storyRows; gapY < y; gapY++) {
      canvas[gapY] = gap;
    }
  }
  for (let i = 0; i < chromeLines.length && y + i < targetRows; i++) {
    canvas[y + i] = padOrTrim(chromeLines[i]!, safeWidth);
  }

  // Enforce exact width + exact height contract.
  for (let i = 0; i < canvas.length; i++) {
    const line = canvas[i] ?? '';
    canvas[i] =
      stripAnsi(line).length === 0 && line.length === 0
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

function resolveChromeBudget(
  targetRows: number,
  workDir: string | undefined,
  width: number,
  _premiumChrome = false,
): number {
  // title + mood + optional tip + optional dir + breathing room
  let budget = 3; // title, mood, spacer
  budget += 1; // tip almost always present
  if ((workDir?.trim().length ?? 0) > 0 && width >= 40) budget += 1;
  // Keep chrome from eating the tank on short stages.
  return Math.min(budget, Math.max(2, Math.floor(targetRows / 3)));
}

export class IdleStageComponent implements Component {
  private readonly state: AppState;
  private readonly preferredRows: number;
  private readonly getPreferredRows: ((width: number) => number) | undefined;
  private sim: IdleTankSim | undefined;

  constructor(options: IdleStageOptions) {
    this.state = options.state;
    this.preferredRows = options.preferredRows ?? IDLE_STAGE_DEFAULT_ROWS;
    this.getPreferredRows = options.getPreferredRows;
  }

  invalidate(): void {}

  /**
   * Drop food at a story-canvas column (and optional row). Requires a prior
   * render that initialized the tank sim.
   */
  tryDropFoodAtContent(col: number, rowInStory?: number): boolean {
    if (!this.sim) return false;
    return dropFood(this.sim, col, rowInStory);
  }

  render(width: number): string[] {
    // Session replay owns the transcript; do not paint idle chrome over it.
    if (this.state.isReplaying) return [];

    const appearance = this.state.appearance ?? DEFAULT_APPEARANCE_PREFERENCES;
    const live = this.getPreferredRows?.(width);
    const preferredRows =
      live !== undefined && Number.isFinite(live) ? Math.trunc(live) : this.preferredRows;

    const safeWidth = Math.max(0, Math.trunc(width));
    const targetRows = resolveIdleStageRows(safeWidth, preferredRows);
    const now = appearanceAnimationNow();
    let simSnapshot: IdleTankSnapshot | undefined;

    if (targetRows > 0 && safeWidth > 0) {
      const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
      const premium = mode === 'premium';
      const premiumChrome =
        shouldRenderAmbientEffects(appearance) && mode !== 'off' && premium;
      const chromeBudget = resolveChromeBudget(
        targetRows,
        this.state.workDir,
        safeWidth,
        premiumChrome,
      );
      const storyRows = Math.max(5, targetRows - chromeBudget);

      if (!this.sim) {
        this.sim = createIdleTankSim(safeWidth, storyRows, now, { premium });
      } else {
        resizeIdleTankSim(this.sim, safeWidth, storyRows);
      }
      tickIdleTankSim(this.sim, now);
      simSnapshot = snapshotIdleTankSim(this.sim);
    }

    const themeMode = this.state.theme === 'light' ? 'light' : 'dark';
    return renderIdleStageLines(width, appearance, {
      nowMs: now,
      preferredRows,
      workDir: this.state.workDir,
      sim: simSnapshot,
      themeMode,
    });
  }
}

/** @internal exported for tests — multi-row character art contract. */
export { resolveFishGlyphRows };
/** @deprecated transitional alias */
export { resolveFishGlyphRows as resolveFoxGlyphRows };
