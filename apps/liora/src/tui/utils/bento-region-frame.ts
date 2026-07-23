/**
 * Wrap region content lines in a rounded bento tile frame.
 * Height grows by 2 (top + bottom); width is the outer tile width.
 *
 * Chrome bands (header/footer) are open-sided — top/bottom rules only — so
 * they do not grow a vertical │ against an adjacent dock tile (││ junction).
 */

import { currentTheme } from '#/tui/theme';
import { truncateToWidth, visibleWidth } from '#/tui/renderer';

export type BentoRegionFrameKind = 'chrome' | 'input' | 'rail' | 'panel';

export interface FrameBentoRegionOptions {
  readonly width: number;
  readonly title?: string;
  readonly kind?: BentoRegionFrameKind;
  readonly focused?: boolean;
  readonly lines: readonly string[];
  /** Stretch closed tiles to at least this outer height (pads empty body rows). */
  readonly minHeight?: number;
}

const TL = '╭';
const TR = '╮';
const BL = '╰';
const BR = '╯';
const H = '─';
const V = '│';

/** Outer rows added by framing (top + bottom). */
export const BENTO_FRAME_ROW_OVERHEAD = 2;
/** Outer cols consumed by side borders (closed tiles only). */
export const BENTO_FRAME_COL_OVERHEAD = 2;

export function frameBentoRegionLines(options: FrameBentoRegionOptions): string[] {
  const width = Math.max(0, Math.floor(options.width));
  if (width < 3) return [...options.lines];

  const kind = options.kind ?? 'chrome';
  if (kind === 'chrome') {
    return frameOpenChromeBand(width, options.title, options.lines);
  }

  const focused = options.focused === true;
  const token =
    focused && kind === 'input' ? 'accent' :
    focused ? 'primary' :
    'border';
  const border = (s: string) => currentTheme.fg(token, s);
  const titleStyle = focused
    ? (s: string) => currentTheme.boldFg('textStrong', s)
    : (s: string) => currentTheme.dimFg('textMuted', s);

  const innerW = width - 2;
  const rows: string[] = [buildTop(width, options.title, border, titleStyle)];

  for (const line of options.lines) {
    const padded = truncateToWidth(line, innerW, '', true);
    rows.push(`${border(V)}${padded}${border(V)}`);
  }

  // Ensure at least one content row so the tile doesn't collapse to a line
  if (options.lines.length === 0) {
    rows.push(`${border(V)}${' '.repeat(innerW)}${border(V)}`);
  }

  const minHeight = Math.max(0, Math.floor(options.minHeight ?? 0));
  if (minHeight > rows.length + 1) {
    const empty = `${border(V)}${' '.repeat(innerW)}${border(V)}`;
    while (rows.length + 1 < minHeight) {
      rows.push(empty);
    }
    // Tall Context rails: pin a dim dock hint on the last body row so the
    // padded tile does not read as an empty bordered shaft.
    if (kind === 'rail' && rows.length > 3) {
      const hint = truncateToWidth(
        currentTheme.dimFg('textMuted', 'Ctrl+/ panels · F1 help'),
        innerW,
        '',
        true,
      );
      rows[rows.length - 1] = `${border(V)}${hint}${border(V)}`;
    }
  }

  rows.push(border(BL + H.repeat(innerW) + BR));
  return rows;
}

/** Open-sided header/footer band — no vertical borders. */
function frameOpenChromeBand(
  width: number,
  title: string | undefined,
  lines: readonly string[],
): string[] {
  const border = (s: string) => currentTheme.fg('border', s);
  const titleStyle = (s: string) => currentTheme.dimFg('textMuted', s);
  const rows: string[] = [];

  // Titled bands (Status): rule with centered label. Untitled (header): no
  // top rule — the soft brand line is the band; only a bottom separator.
  if (title && width >= 4) {
    rows.push(buildOpenTop(width, title, border, titleStyle));
  }

  for (const line of lines) {
    rows.push(truncateToWidth(line, width, '', true));
  }
  if (lines.length === 0) {
    rows.push(' '.repeat(width));
  }
  rows.push(border(H.repeat(width)));
  return rows;
}

function buildOpenTop(
  width: number,
  title: string | undefined,
  border: (s: string) => string,
  titleStyle: (s: string) => string,
): string {
  if (!title || width < 4) {
    return border(H.repeat(width));
  }
  const label = ` ${title} `;
  const clipped = visibleWidth(label) > width ? truncateToWidth(label, width, '', false) : label;
  const visible = visibleWidth(clipped);
  const rest = Math.max(0, width - visible);
  const left = Math.floor(rest / 2);
  const right = rest - left;
  return border(H.repeat(left)) + titleStyle(clipped) + border(H.repeat(right));
}

function buildTop(
  width: number,
  title: string | undefined,
  border: (s: string) => string,
  titleStyle: (s: string) => string,
): string {
  const inner = width - 2;
  if (!title || inner < 4) {
    return border(TL + H.repeat(inner) + TR);
  }
  const label = ` ${title} `;
  const clipped = visibleWidth(label) > inner ? truncateToWidth(label, inner, '', false) : label;
  const visible = visibleWidth(clipped);
  const rest = Math.max(0, inner - visible);
  const left = Math.floor(rest / 2);
  const right = rest - left;
  return border(TL) + border(H.repeat(left)) + titleStyle(clipped) + border(H.repeat(right)) + border(TR);
}

/**
 * Content width available inside a framed tile of outer `width`.
 * Chrome bands are open-sided and use the full outer width.
 */
export function bentoFrameContentWidth(outerWidth: number, kind: BentoRegionFrameKind = 'panel'): number {
  if (kind === 'chrome') return Math.max(0, outerWidth);
  return Math.max(0, outerWidth - BENTO_FRAME_COL_OVERHEAD);
}
