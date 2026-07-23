/**
 * Bento tile chrome — rounded frames painted onto the native frame renderer.
 * Single visual language for chrome regions and workspace panels.
 */

import type { NativeFrameRenderer } from '@harness-kit/tui-renderer';
import { truncateToWidth, visibleWidth } from '@harness-kit/tui-renderer';

import { currentTheme } from '#/tui/theme';

export type BentoTileKind = 'hero' | 'chrome' | 'panel' | 'input';

export interface BentoTilePaintOptions {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly title?: string;
  readonly icon?: string;
  readonly focused?: boolean;
  readonly kind?: BentoTileKind;
  /** Pre-rendered content lines (visible width = width-2). */
  readonly content?: readonly string[];
  /** Soft activity pulse (non-focused panels with recent updates). */
  readonly activity?: boolean;
  /** Skip the bottom ╰─╯ when a sibling tile abuts below (avoids ╰╭ double rule). */
  readonly omitBottom?: boolean;
}

const CHARS = {
  tl: '╭',
  tr: '╮',
  bl: '╰',
  br: '╯',
  h: '─',
  v: '│',
} as const;

function borderToken(focused: boolean, kind: BentoTileKind): 'primary' | 'accent' | 'border' {
  if (focused) return kind === 'input' ? 'accent' : 'primary';
  return 'border';
}

/**
 * Paint a rounded bento tile. Returns the inner content rect dimensions
 * callers can use when measuring content ahead of time.
 */
export function paintBentoTile(
  frame: NativeFrameRenderer,
  options: BentoTilePaintOptions,
): { contentWidth: number; contentHeight: number } {
  const {
    x,
    y,
    width,
    height,
    title,
    icon,
    focused = false,
    kind = 'panel',
    content = [],
    activity = false,
    omitBottom = false,
  } = options;

  const contentWidth = Math.max(0, width - 2);
  const chromeRows = omitBottom ? 1 : 2;
  const contentHeight = Math.max(0, height - chromeRows);

  if (width < 2 || height < 2) {
    return { contentWidth, contentHeight };
  }

  // Hero transcript: no chrome frame — pure content surface for reading calm.
  if (kind === 'hero') {
    for (let row = 0; row < height; row++) {
      const line = truncateToWidth(content[row] ?? '', width, '', true);
      frame.writeAnsiText(x, y + row, line);
    }
    return { contentWidth: width, contentHeight: height };
  }

  const token = borderToken(focused, kind);
  const border = (s: string) => currentTheme.fg(token, s);
  const titleFg = focused
    ? (s: string) => currentTheme.boldFg('textStrong', s)
    : (s: string) => currentTheme.fg('textMuted', s);

  // Top border with optional title (+ focus accent baked into the fill, never
  // a second write that can overwrite corners when emoji width is wrong).
  const top = truncateToWidth(
    buildTopBorder(width, title, icon, activity, focused, kind, border, titleFg),
    width,
    '',
    true,
  );
  frame.writeAnsiText(x, y, top);

  for (let row = 0; row < contentHeight; row++) {
    const raw = content[row] ?? '';
    const padded = truncateToWidth(raw, contentWidth, '', true);
    const line = truncateToWidth(
      `${border(CHARS.v)}${padded}${border(CHARS.v)}`,
      width,
      '',
      true,
    );
    frame.writeAnsiText(x, y + 1 + row, line);
  }

  if (!omitBottom && height >= 2) {
    frame.writeAnsiText(
      x,
      y + height - 1,
      truncateToWidth(
        border(CHARS.bl + CHARS.h.repeat(Math.max(0, width - 2)) + CHARS.br),
        width,
        '',
        true,
      ),
    );
  }

  // Restamp removed — intermediate space→glyph writes collapse before present()
  // diffs, so they cannot force a re-emit against an equal previous cell.

  return { contentWidth, contentHeight };
}

function buildTopBorder(
  width: number,
  title: string | undefined,
  icon: string | undefined,
  activity: boolean,
  focused: boolean,
  kind: BentoTileKind,
  border: (s: string) => string,
  titleFg: (s: string) => string,
): string {
  const inner = Math.max(0, width - 2);
  if (!title || inner < 4) {
    return border(CHARS.tl + CHARS.h.repeat(inner) + CHARS.tr);
  }

  const activityDot = activity && !focused ? currentTheme.fg('accent', '•') : '';
  const label = icon
    ? ` ${icon} ${title}${activityDot ? ` ${activityDot}` : ''} `
    : ` ${title}${activityDot ? ` ${activityDot}` : ''} `;
  const truncated = truncateToWidth(label, inner, '', false);
  const visible = visibleWidth(truncated);
  const rest = Math.max(0, inner - visible);
  const left = Math.floor(rest / 2);
  const right = rest - left;
  const fill = (n: number) => {
    if (n <= 0) return '';
    // Focused input/panel: accent fill under the title instead of dim dashes.
    if (focused && (kind === 'input' || kind === 'panel')) {
      return currentTheme.fg('accent', '━'.repeat(n));
    }
    return border(CHARS.h.repeat(n));
  };

  return border(CHARS.tl) + fill(left) + titleFg(truncated) + fill(right) + border(CHARS.tr);
}

/** Paint only the perimeter of a tile (no content) — used for empty chrome shells. */
export function paintBentoTileFrame(
  frame: NativeFrameRenderer,
  options: Omit<BentoTilePaintOptions, 'content'>,
): void {
  paintBentoTile(frame, { ...options, content: [] });
}
