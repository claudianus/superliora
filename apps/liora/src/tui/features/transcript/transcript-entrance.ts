/**
 * Transcript entrance + live stream edge effects.
 *
 * Turns newly mounted transcript blocks into a short fade/gradient reveal, and
 * paints a soft glow on the growing edge of live stream text so catch-up is
 * actually visible (not just slower dumps).
 */

import type { AppearancePreferences } from '#/tui/config';
import {
  ANSI_RESET_STYLE,
  ansiTextToCells,
  escapeTerminalText,
  mixHexColor,
  styleToAnsi,
  type RendererCell,
  type RendererCellStyle,
} from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  resolveQualityAdjustedAmbientEffectMode,
  shouldRenderAmbientEffects,
} from '#/tui/features/appearance/appearance-effects';

/** Premium entrance length — long enough to read as motion, short enough not to lag. */
export const TRANSCRIPT_ENTRANCE_MS_PREMIUM = 560;
/** Subtle profile stretches the same ease so it still finishes cleanly. */
export const TRANSCRIPT_ENTRANCE_MS_SUBTLE = 640;
/** Live stream tail glow width in visual clusters. */
export const STREAM_TAIL_GLOW_CLUSTERS = 28;
/** How long a "fresh" tail glow lingers after the last paint. */
export const STREAM_TAIL_GLOW_MS = 480;

export type TranscriptEntranceKind =
  | 'assistant'
  | 'thinking'
  | 'tool'
  | 'status'
  | 'notice'
  | 'generic';

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function easeOutCubic(t: number): number {
  const p = clamp01(t);
  return 1 - (1 - p) ** 3;
}

export function transcriptEntranceDurationMs(
  appearance: AppearancePreferences = getActiveAppearancePreferences(),
): number {
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  if (mode === 'off') return 0;
  return mode === 'subtle' ? TRANSCRIPT_ENTRANCE_MS_SUBTLE : TRANSCRIPT_ENTRANCE_MS_PREMIUM;
}

export function transcriptEntranceProgress(
  startedAtMs: number,
  appearance: AppearancePreferences = getActiveAppearancePreferences(),
  nowMs: number = appearanceAnimationNow(),
): number {
  if (!shouldRenderAmbientEffects(appearance)) return 1;
  const duration = transcriptEntranceDurationMs(appearance);
  // `startedAtMs` may be 0 (tests / epoch); only reject negative sentinels.
  if (duration <= 0 || startedAtMs < 0) return 1;
  return easeOutCubic((nowMs - startedAtMs) / duration);
}

export function isTranscriptEntranceActive(
  startedAtMs: number,
  appearance: AppearancePreferences = getActiveAppearancePreferences(),
  nowMs: number = appearanceAnimationNow(),
): boolean {
  return transcriptEntranceProgress(startedAtMs, appearance, nowMs) < 0.999;
}

/** Tool header entrance settle length — a quick highlight fade, not a wash. */
export const TOOL_HEADER_ENTRANCE_MS = 280;
/** Turn boundary cue length — same quick-settle family, marks turn start/end. */
export const TURN_BOUNDARY_CUE_MS = 300;

/** Header entrance TTL (0 when motion is off; subtle stretches ×1.2). */
export function toolHeaderEntranceDurationMs(
  appearance: AppearancePreferences = getActiveAppearancePreferences(),
): number {
  if (!shouldRenderAmbientEffects(appearance)) return 0;
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  return mode === 'subtle' ? TOOL_HEADER_ENTRANCE_MS * 1.2 : TOOL_HEADER_ENTRANCE_MS;
}

/** Turn boundary cue TTL (0 when motion is off; subtle stretches ×1.2, ≤ 400ms). */
export function turnBoundaryCueDurationMs(
  appearance: AppearancePreferences = getActiveAppearancePreferences(),
): number {
  if (!shouldRenderAmbientEffects(appearance)) return 0;
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  return mode === 'subtle' ? TURN_BOUNDARY_CUE_MS * 1.2 : TURN_BOUNDARY_CUE_MS;
}

/** True while a turn boundary cue is still animating at this clock. */
export function isTurnBoundaryCueActive(
  startedAtMs: number | undefined,
  appearance: AppearancePreferences = getActiveAppearancePreferences(),
  nowMs: number = appearanceAnimationNow(),
): boolean {
  if (startedAtMs === undefined || startedAtMs < 0) return false;
  const duration = turnBoundaryCueDurationMs(appearance);
  return duration > 0 && nowMs - startedAtMs < duration;
}

/**
 * Brief highlight settle for a freshly mounted tool header. Blends every
 * styled run toward a brand highlight that decays over the entrance window,
 * preserving the header's internal ANSI structure (bullet, verb, chips) —
 * unlike a plain-text flash. Returns the line untouched once settled or when
 * ambient motion is off, so settled headers stay byte-stable for the cache.
 */
export function applyToolHeaderEntrance(
  line: string,
  startedAtMs: number,
  appearance: AppearancePreferences = getActiveAppearancePreferences(),
  nowMs: number = appearanceAnimationNow(),
): string {
  return applyHighlightSettle(line, startedAtMs, toolHeaderEntranceDurationMs(appearance), nowMs);
}

/**
 * Brief highlight settle marking a turn boundary on a single rendered line —
 * turn start paints the incoming response's first visible line, turn end
 * paints the final block's last line (PREMIUM.md §7.3). Same ANSI-preserving
 * blend as the tool header entrance; returns the line untouched once settled
 * or when ambient motion is off, so settled transcripts stay byte-stable.
 */
export function applyTurnBoundaryCue(
  line: string,
  startedAtMs: number | undefined,
  appearance: AppearancePreferences = getActiveAppearancePreferences(),
  nowMs: number = appearanceAnimationNow(),
): string {
  if (startedAtMs === undefined) return line;
  return applyHighlightSettle(line, startedAtMs, turnBoundaryCueDurationMs(appearance), nowMs);
}

/** Shared brand-highlight decay behind the header/turn settles. */
function applyHighlightSettle(
  line: string,
  startedAtMs: number,
  durationMs: number,
  nowMs: number,
): string {
  if (line.length === 0) return line;
  if (durationMs <= 0 || startedAtMs < 0) return line;
  const p = easeOutCubic((nowMs - startedAtMs) / durationMs);
  if (p >= 1) return line;
  const cells = ansiTextToCells(line);
  if (cells.length === 0) return line;
  const highlight = mixHexColor(
    currentTheme.color('primary'),
    currentTheme.color('glow'),
    0.4,
  );
  const intensity = 1 - p;
  const next = cells.map((cell) => {
    if (cell.char === ' ' && cell.style === undefined) return cell;
    return {
      ...cell,
      style: mixStyle(cell.style, highlight, intensity * 0.65, {
        towardBold: intensity > 0.5,
      }),
    };
  });
  return cellsToAnsi(next);
}

function mutedBlendHex(kind: TranscriptEntranceKind): string {
  // Soft start color — brand-tinted for assistant/tool, mute for status.
  switch (kind) {
    case 'assistant':
      return mixHexColor(currentTheme.color('background'), currentTheme.color('gradientStart'), 0.35);
    case 'tool':
      return mixHexColor(currentTheme.color('background'), currentTheme.color('primary'), 0.28);
    case 'thinking':
      return mixHexColor(currentTheme.color('background'), currentTheme.color('textDim'), 0.55);
    case 'status':
    case 'notice':
      return mixHexColor(currentTheme.color('background'), currentTheme.color('accent'), 0.22);
    default:
      return currentTheme.color('textDim');
  }
}

function glowHex(kind: TranscriptEntranceKind): string {
  switch (kind) {
    case 'assistant':
      return currentTheme.color('gradientStart');
    case 'tool':
      return currentTheme.color('primary');
    case 'thinking':
      return currentTheme.color('particle');
    default:
      return currentTheme.color('accent');
  }
}

function mixStyle(
  style: RendererCellStyle | undefined,
  toward: string,
  intensity: number,
  options: { readonly forceDim?: boolean; readonly towardBold?: boolean } = {},
): RendererCellStyle | undefined {
  const t = clamp01(intensity);
  if (t <= 0 && options.forceDim !== true) {
    return style === undefined ? { dim: true } : { ...style, dim: true };
  }
  const baseFg = style?.fg ?? currentTheme.color('text');
  const fg = mixHexColor(toward, baseFg, t);
  const next: RendererCellStyle = {
    ...style,
    fg,
    dim: options.forceDim === true || t < 0.42 ? true : style?.dim,
    bold: options.towardBold === true && t > 0.55 ? true : style?.bold,
  };
  return next;
}

function cellsToAnsi(cells: readonly RendererCell[]): string {
  if (cells.length === 0) return '';
  const out: string[] = [];
  let active: RendererCellStyle | undefined;
  let hasStyle = false;
  for (const cell of cells) {
    // Wide-glyph continuation pads are empty width-0 markers. Emitting them as
    // spaces doubles CJK/emoji spacing mid-entrance (then "fixes" when polish ends).
    if (cell.continuation === true || cell.width === 0 || cell.char.length === 0) {
      continue;
    }
    if (!stylesEqual(active, cell.style)) {
      active = cell.style;
      out.push(styleToAnsi(active));
      hasStyle = true;
    }
    // Cell glyphs are already single display clusters from ansiTextToCells —
    // do not re-run escapeTerminalText (it is for raw user strings).
    out.push(cell.char);
  }
  if (hasStyle) out.push(ANSI_RESET_STYLE);
  return out.join('');
}

/** Strip CSI/OSC so tests and callers can assert on visible payload. */
export function visibleTranscriptPayload(text: string): string {
  return escapeTerminalText(text);
}

function stylesEqual(a: RendererCellStyle | undefined, b: RendererCellStyle | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return (
    a.fg === b.fg &&
    a.bg === b.bg &&
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.inverse === b.inverse
  );
}

/**
 * Fade a full rendered block from muted → full color over the entrance window.
 * Early rows lead slightly so the block appears to wash in top-to-bottom.
 */
export function applyTranscriptEntrance(
  lines: readonly string[],
  startedAtMs: number,
  kind: TranscriptEntranceKind = 'generic',
  appearance: AppearancePreferences = getActiveAppearancePreferences(),
  nowMs: number = appearanceAnimationNow(),
): string[] {
  if (lines.length === 0) return lines as string[];
  if (!shouldRenderAmbientEffects(appearance)) return lines as string[];
  const progress = transcriptEntranceProgress(startedAtMs, appearance, nowMs);
  if (progress >= 0.999) return lines as string[];

  const mute = mutedBlendHex(kind);
  const glow = glowHex(kind);
  const rowCount = lines.length;

  return lines.map((line, rowIndex) => {
    if (line.length === 0) return line;
    // Top rows finish first; bottom rows lag a little for a wash-in feel.
    const rowBias = rowCount <= 1 ? 0 : (rowIndex / (rowCount - 1)) * 0.22;
    const rowProgress = easeOutCubic(clamp01((progress - rowBias) / Math.max(0.01, 1 - rowBias)));
    const cells = ansiTextToCells(line);
    if (cells.length === 0) return line;

    // Leading edge shimmer while the block is still entering.
    const edgeBoost = rowProgress < 0.92 ? 0.18 * (1 - rowProgress) : 0;
    const next = cells.map((cell, index) => {
      if (cell.char === ' ' && cell.style === undefined) return cell;
      let intensity = rowProgress;
      // Soft left-edge lead-in on the first couple of rows.
      if (rowIndex <= 1 && edgeBoost > 0) {
        const lead = clamp01(index / Math.max(1, cells.length - 1));
        intensity = clamp01(intensity + edgeBoost * (1 - lead));
      }
      const toward = intensity < 0.55 ? mute : mixHexColor(mute, glow, 0.35);
      return {
        ...cell,
        style: mixStyle(cell.style, toward, intensity, {
          forceDim: intensity < 0.35,
          towardBold: kind === 'tool' || kind === 'assistant',
        }),
      };
    });
    return cellsToAnsi(next);
  });
}

/**
 * Soft brand glow on the live stream tail — the newest clusters stay brighter
 * so catch-up reads as ink flowing, not a static dump.
 */
export function applyStreamTailGlow(
  lines: readonly string[],
  kind: TranscriptEntranceKind = 'assistant',
  appearance: AppearancePreferences = getActiveAppearancePreferences(),
  options: {
    readonly active?: boolean;
    readonly glowClusters?: number;
  } = {},
): string[] {
  if (lines.length === 0) return lines as string[];
  if (!shouldRenderAmbientEffects(appearance)) return lines as string[];
  if (options.active === false) return lines as string[];

  // Find last non-empty line.
  let lastIndex = lines.length - 1;
  while (lastIndex > 0 && lines[lastIndex]!.trim().length === 0) lastIndex--;
  const line = lines[lastIndex]!;
  if (line.trim().length === 0) return lines as string[];

  const cells = ansiTextToCells(line);
  if (cells.length === 0) return lines as string[];

  const glowClusters = options.glowClusters ?? STREAM_TAIL_GLOW_CLUSTERS;
  const glow = glowHex(kind);
  const spark = currentTheme.color('glow');
  const start = Math.max(0, cells.length - glowClusters);
  const nextCells = cells.map((cell, index) => {
    if (index < start) return cell;
    if (cell.char === ' ' && cell.style === undefined) return cell;
    const local = (index - start + 1) / Math.max(1, cells.length - start);
    // Newest clusters closest to full brand glow + hot tip on the last few.
    const tipBoost = local > 0.78 ? 0.32 : local > 0.55 ? 0.12 : 0;
    const intensity = clamp01(0.22 + 0.78 * local * local + tipBoost);
    const baseFg = cell.style?.fg ?? currentTheme.color('text');
    const toward = local > 0.7 ? mixHexColor(glow, spark, 0.55) : glow;
    return {
      ...cell,
      style: {
        ...cell.style,
        fg: mixHexColor(baseFg, toward, intensity),
        // Only the very tip goes bold. A lower threshold made whole spans
        // pop between bold/regular as the wave moved — visible flicker.
        bold: local > 0.86 ? true : cell.style?.bold,
      },
    };
  });

  const next = [...lines];
  next[lastIndex] = cellsToAnsi(nextCells);
  return next;
}

/**
 * Compose entrance fade + optional live tail glow for a component render path.
 */
export function polishTranscriptLines(
  lines: readonly string[],
  options: {
    readonly startedAtMs: number;
    readonly kind?: TranscriptEntranceKind;
    readonly streaming?: boolean;
    readonly appearance?: AppearancePreferences;
    readonly nowMs?: number;
  },
): string[] {
  const appearance = options.appearance ?? getActiveAppearancePreferences();
  const kind = options.kind ?? 'generic';
  const nowMs = options.nowMs ?? appearanceAnimationNow();
  let next = applyTranscriptEntrance(lines, options.startedAtMs, kind, appearance, nowMs);
  if (options.streaming === true) {
    next = applyStreamTailGlow(next, kind, appearance, { active: true });
  }
  return next;
}
