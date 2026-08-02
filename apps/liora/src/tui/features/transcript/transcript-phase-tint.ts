/**
 * Soft full-width background tints for transcript work-unit phases.
 * Derived from existing palette tokens via mixHex so custom themes inherit
 * without new ColorPalette fields (v1). Tint strength stays mild (~10–14%).
 */

import chalk from 'chalk';

import { mixHexColor, truncateToWidth, visibleWidth } from '#/tui/renderer';
import { currentTheme, type ColorPalette } from '#/tui/theme';

export type TranscriptPhaseKind = 'thinking' | 'tools' | 'answer' | 'user';

/** Mix ratio: higher = closer to canvas (subtler tint). */
const TINT_MIX: Record<TranscriptPhaseKind, number> = {
  thinking: 0.9,
  tools: 0.88,
  answer: 0.92,
  user: 0.9,
};

function phaseAccent(kind: TranscriptPhaseKind, palette: ColorPalette): string {
  switch (kind) {
    case 'thinking':
      return palette.syntaxMeta;
    case 'tools':
      return palette.primary;
    case 'answer':
      return palette.surfaceRaised;
    case 'user':
      return palette.roleUser;
  }
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
  const clipped = truncateToWidth(line, safeWidth, '…');
  const visible = visibleWidth(clipped);
  const pad = Math.max(0, safeWidth - visible);
  const padded = pad > 0 ? clipped + ' '.repeat(pad) : clipped;
  return chalk.bgHex(bg)(padded);
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
