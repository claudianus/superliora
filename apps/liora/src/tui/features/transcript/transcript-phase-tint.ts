/**
 * Soft full-width background tints for transcript work-unit phases.
 * Derived from existing palette tokens via mixHex so custom themes inherit
 * without new ColorPalette fields (v1). Tint strength stays mild (~10–14%).
 *
 * thinking + tools share one work-block tint so they read as a single dense
 * unit; answer / user keep distinct tints with breathing-room blanks.
 */

import chalk from 'chalk';

import { ANSI_RESET_STYLE, mixHexColor, truncateToWidth, visibleWidth } from '#/tui/renderer';
import { currentTheme, type ColorPalette } from '#/tui/theme';

/** Drop trailing full resets so width-pad stays inside the tint bg wrap. */
function stripTrailingResets(line: string): string {
  let out = line;
  while (out.endsWith(ANSI_RESET_STYLE)) {
    out = out.slice(0, -ANSI_RESET_STYLE.length);
  }
  return out;
}

export type TranscriptPhaseKind = 'thinking' | 'tools' | 'answer' | 'user';

/** Mix ratio: higher = closer to canvas (subtler tint). */
const TINT_MIX: Record<TranscriptPhaseKind, number> = {
  // Same mix + accent as tools — one continuous work block.
  thinking: 0.88,
  tools: 0.88,
  answer: 0.92,
  user: 0.9,
};

function phaseAccent(kind: TranscriptPhaseKind, palette: ColorPalette): string {
  switch (kind) {
    case 'thinking':
    case 'tools':
      // Shared work-block fill; gutter glyphs still differ via labels.
      return palette.primary;
    case 'answer':
      return palette.surfaceRaised;
    case 'user':
      return palette.roleUser;
  }
}

/** True when the phase belongs to the tight thinking→tools work block. */
export function isWorkBlockPhase(kind: TranscriptPhaseKind): boolean {
  return kind === 'thinking' || kind === 'tools';
}

export function phaseTintHex(
  kind: TranscriptPhaseKind,
  palette: ColorPalette = currentTheme.palette,
): string {
  const accent = phaseAccent(kind, palette);
  const canvas = palette.background;
  return mixHexColor(accent, canvas, TINT_MIX[kind]);
}

/**
 * Paint a soft background across the full terminal width so phase blocks
 * read as distinct work units. Pads with spaces to `width` (visible cells).
 */
export function applyPhaseTintLine(
  line: string,
  width: number,
  kind: TranscriptPhaseKind,
  palette?: ColorPalette,
): string {
  const p = palette ?? currentTheme.palette;
  const bg = phaseTintHex(kind, p);
  const safeWidth = Math.max(1, width);
  // Truncate first so phase chrome never overflows narrow terminals.
  // Text.closeLine leaves a trailing \x1b[0m; if we pad after that reset,
  // chalk.bgHex dies before the spaces and the canvas shows through as a
  // black bar from end-of-text to the right edge.
  const clipped = stripTrailingResets(truncateToWidth(line, safeWidth, '…'));
  const visible = visibleWidth(clipped);
  const pad = Math.max(0, safeWidth - visible);
  const padded = pad > 0 ? clipped + ' '.repeat(pad) : clipped;
  return chalk.bgHex(bg)(padded);
}

/**
 * Tint a row inside a work block. Blank rows keep the same fill so thinking→tools
 * stays one solid band (untinted blanks are only for answer / user breathing room).
 */
export function applyWorkBlockTintLine(
  line: string,
  width: number,
  kind: 'thinking' | 'tools',
  palette?: ColorPalette,
): string {
  if (line.trim().length === 0) {
    return applyPhaseTintLine('', width, kind, palette);
  }
  return applyPhaseTintLine(line, width, kind, palette);
}

/** Left gutter bar for stronger separation without loud fills. */
export function phaseGutter(kind: TranscriptPhaseKind, palette?: ColorPalette): string {
  const p = palette ?? currentTheme.palette;
  const accent = phaseAccent(kind, p);
  return chalk.hex(accent)('▌');
}

/** Short phase chrome label for work-unit headers. */
export function phaseHeaderLabel(kind: TranscriptPhaseKind): string {
  switch (kind) {
    case 'thinking':
      return 'thinking';
    case 'tools':
      return 'tools';
    case 'answer':
      return 'answer';
    case 'user':
      return 'you';
  }
}

/**
 * One-line phase header: `▌ tools · 7 · +42/−10` with soft tint.
 * Used by chain summary and optional compact density chrome.
 */
export function formatPhaseHeaderLine(
  kind: TranscriptPhaseKind,
  detail: string | undefined,
  width: number,
  palette?: ColorPalette,
): string {
  const p = palette ?? currentTheme.palette;
  const gutter = phaseGutter(kind, p);
  const label = chalk.bold.hex(phaseAccent(kind, p))(phaseHeaderLabel(kind));
  const rest =
    detail !== undefined && detail.length > 0
      ? chalk.hex(p.textDim)(` · ${detail}`)
      : '';
  const body = `${gutter} ${label}${rest}`;
  // applyPhaseTintLine clips to width for narrow terminals.
  return applyPhaseTintLine(body, width, kind, p);
}
