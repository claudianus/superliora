/**
 * Intelligent empty-transcript stage.
 *
 * After the cinematic splash, the transcript is just Welcome + empty space.
 * This component fills that void with a living ambient scene: drifting sky,
 * moon-phase pulse, constellation "thought" lines, and a rotating tip —
 * then vanishes the moment real transcript content arrives.
 *
 * Motion reuses the process-wide appearance animation clock (no private
 * scheduler). Gates match splash/welcome ambient effects.
 */

import type { Component } from '#/tui/renderer';
import {
  hashRendererEffectSeed,
  rendererPositiveModulo,
  truncateToWidth,
  visibleWidth,
} from '#/tui/renderer';
import chalk from 'chalk';

import {
  DEFAULT_APPEARANCE_PREFERENCES,
  type AppearancePreferences,
} from '#/tui/config';
import { MOON_SPINNER_FRAMES } from '#/tui/constant/rendering';
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
import { ttui } from '#/tui/utils/tui-i18n';

/** Soft constellation glyphs — monospace-safe, no dingbat spam. */
const CONSTELLATION = ['.', '·', '˚', '+', '*', '⋆', '◦'] as const;

const IDLE_TIP_ROTATE_MS = 7_200;
const IDLE_LINE_ROTATE_MS = 4_800;
const IDLE_MOON_TICK_MS = 420;

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
   * Preferred stage height in rows. Clamped at render time to fit width
   * and keep the scene readable on short terminals.
   */
  readonly preferredRows?: number;
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

export function resolveIdleStageRows(width: number, preferredRows = 12): number {
  const safeWidth = Math.max(0, Math.trunc(width));
  if (safeWidth < 24) return 0;
  if (safeWidth < 40) return Math.min(preferredRows, 7);
  if (safeWidth < 60) return Math.min(preferredRows, 9);
  return Math.min(Math.max(8, preferredRows), 14);
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

export function resolveIdleMoonGlyph(nowMs: number): string {
  if (MOON_SPINNER_FRAMES.length === 0) return '·';
  const index = Math.floor(nowMs / IDLE_MOON_TICK_MS) % MOON_SPINNER_FRAMES.length;
  return MOON_SPINNER_FRAMES[index] ?? MOON_SPINNER_FRAMES[0]!;
}

/**
 * Build the pure-text idle canvas (no outer chrome). Used by the component
 * and unit tests.
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
  const rows = resolveIdleStageRows(safeWidth, options?.preferredRows ?? 12);
  if (rows === 0 || safeWidth === 0) return [];

  const now = options?.nowMs ?? appearanceAnimationNow();
  const showAmbient =
    shouldRenderAmbientEffects(appearance) &&
    resolveQualityAdjustedAmbientEffectMode(appearance) !== 'off';
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  const premium = mode === 'premium';

  // Sky: taller meteor/star field so the empty pane feels inhabited.
  const skyRows = Math.max(3, rows - 5);
  const sky = showAmbient
    ? renderMeteorField(safeWidth, skyRows, 'idle:sky', appearance)
    : Array.from({ length: skyRows }, () => ' '.repeat(safeWidth));

  // Overlay a soft constellation belt near mid-sky (deterministic drift).
  if (showAmbient) {
    paintConstellationBelt(sky, safeWidth, now, premium);
  }

  const moon = resolveIdleMoonGlyph(now);
  const moodKey = resolveIdleMoodKey(now);
  const mood = ttui(moodKey);
  const tipKey = resolveIdleTipKey(now);
  const tip = tipKey === undefined ? '' : ttui(tipKey);

  const title = showAmbient
    ? renderSpectacularText(ttui('tui.idle.title'), 'idle:title', appearance, {
        intense: premium,
        pace: 'slow',
      })
    : chalk.hex(currentTheme.palette.textDim)(ttui('tui.idle.title'));

  const moonStyled = showAmbient
    ? currentTheme.boldFg(premium ? 'glow' : 'primary', moon)
    : chalk.hex(currentTheme.palette.glow)(moon);

  const moodLine = centerPlain(
    safeWidth,
    `${moonStyled}  ${chalk.hex(currentTheme.palette.textDim)(mood)}`,
  );

  const titleLine = centerPlain(safeWidth, title);

  const tipLine =
    tip.length > 0
      ? centerPlain(
          safeWidth,
          chalk.hex(currentTheme.palette.textMuted)(
            `${ttui('tui.idle.tipPrefix')}${truncateToWidth(tip, Math.max(8, safeWidth - 8), '…')}`,
          ),
        )
      : '';

  const workDir = options?.workDir?.trim() ?? '';
  const dirLine =
    workDir.length > 0 && safeWidth >= 40
      ? centerPlain(
          safeWidth,
          chalk.hex(currentTheme.palette.textMuted)(
            truncateToWidth(workDir, Math.max(12, safeWidth - 4), '…'),
          ),
        )
      : '';

  const topRail = showAmbient
    ? renderParticleRail(safeWidth, appearance, 'idle:top')
    : chalk.hex(currentTheme.palette.textMuted)('·'.repeat(Math.min(safeWidth, 24)).padEnd(safeWidth));
  const bottomRail = showAmbient
    ? renderParticleRail(safeWidth, appearance, 'idle:bottom')
    : topRail;

  const body: string[] = [
    '',
    padOrTrim(topRail, safeWidth),
    ...sky.map((row) => padOrTrim(row, safeWidth)),
    '',
    padOrTrim(titleLine, safeWidth),
    padOrTrim(moodLine, safeWidth),
  ];
  if (tipLine.length > 0) body.push(padOrTrim(tipLine, safeWidth));
  if (dirLine.length > 0) body.push(padOrTrim(dirLine, safeWidth));
  body.push(padOrTrim(bottomRail, safeWidth), '');

  // Keep height stable-ish: trim or pad to resolved row budget when possible.
  if (body.length > rows + 2) {
    return body.slice(0, rows + 2);
  }
  return body;
}

function paintConstellationBelt(
  sky: string[],
  width: number,
  nowMs: number,
  premium: boolean,
): void {
  if (sky.length === 0 || width <= 0) return;
  const base = hashRendererEffectSeed('idle:constellation');
  const phase = Math.floor(nowMs / (premium ? 90 : 160));
  const beltY = Math.min(sky.length - 1, Math.max(1, Math.floor(sky.length * 0.45)));
  const stars = premium
    ? Math.max(4, Math.min(14, Math.floor(width / 7)))
    : Math.max(3, Math.min(8, Math.floor(width / 10)));

  for (let i = 0; i < stars; i++) {
    const h = base + i * 97 + phase;
    const x = rendererPositiveModulo(h + phase * (1 + (i % 3)), width);
    const y = rendererPositiveModulo(beltY + (h % 3) - 1, sky.length);
    const glyph = CONSTELLATION[rendererPositiveModulo(h, CONSTELLATION.length)]!;
    const bright = rendererPositiveModulo(h + phase, 5) === 0;
    const painted = bright
      ? currentTheme.fg(premium ? 'glow' : 'particle', glyph)
      : currentTheme.dimFg('textMuted', glyph);
    sky[y] = replaceCell(sky[y] ?? ' '.repeat(width), x, painted, width);
  }

  // Occasional "signal" spark that walks the belt — reads as alive, not noise.
  // Keep monospace-safe (no dingbats) — same rule as appearance-effects particles.
  const walk = rendererPositiveModulo(phase * 2 + base, Math.max(1, width));
  const signal = currentTheme.fg('primary', premium ? '*' : '·');
  sky[beltY] = replaceCell(sky[beltY] ?? ' '.repeat(width), walk, signal, width);
}

function replaceCell(line: string, x: number, styled: string, width: number): string {
  // Sky lines from renderMeteorField are ANSI-heavy; when ambient is on we
  // rebuild a plain row for constellation overlay cells only if the line is
  // still mostly spaces (cheap path). Otherwise leave the meteor paint.
  const plain = stripAnsi(line);
  if (plain.trim().length === 0 || plain.replaceAll(' ', '').length < width * 0.08) {
    const cells = plain.padEnd(width).slice(0, width).split('');
    if (x >= 0 && x < cells.length) cells[x] = '·';
    // Rebuild with one styled cell at x.
    const out: string[] = [];
    for (let i = 0; i < cells.length; i++) {
      if (i === x) out.push(styled);
      else out.push(cells[i] === ' ' ? ' ' : currentTheme.dimFg('textMuted', cells[i]!));
    }
    return out.join('');
  }
  return line;
}

function centerPlain(width: number, text: string): string {
  const w = visibleWidth(text);
  if (w >= width) return truncateToWidth(text, width, '…');
  const left = Math.floor((width - w) / 2);
  return `${' '.repeat(left)}${text}`;
}

function padOrTrim(text: string, width: number): string {
  const w = visibleWidth(text);
  if (w === width) return text;
  if (w > width) return truncateToWidth(text, width, '…');
  return `${text}${' '.repeat(width - w)}`;
}

function stripAnsi(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

export class IdleStageComponent implements Component {
  private readonly state: AppState;
  private readonly preferredRows: number;

  constructor(options: IdleStageOptions) {
    this.state = options.state;
    this.preferredRows = options.preferredRows ?? 12;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const appearance = this.state.appearance ?? DEFAULT_APPEARANCE_PREFERENCES;
    return renderIdleStageLines(width, appearance, {
      preferredRows: this.preferredRows,
      workDir: this.state.workDir,
    });
  }
}
