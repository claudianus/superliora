import type { RendererRect } from './compositor';
import { truncateToWidth, visibleWidth } from './text-component';

// ---------------------------------------------------------------------------
// Panel border hit-test types
// ---------------------------------------------------------------------------

export type PanelBorderZone =
  | 'resize-left'
  | 'resize-right'
  | 'resize-top'
  | 'resize-bottom'
  | 'resize-top-left'
  | 'resize-top-right'
  | 'resize-bottom-left'
  | 'resize-bottom-right'
  | 'title-bar'
  | 'body'
  | 'none';

export interface PanelHitTestResult {
  readonly zone: PanelBorderZone;
  readonly panelId?: string;
}

// ---------------------------------------------------------------------------
// Panel frame rendering types
// ---------------------------------------------------------------------------

export type PanelFrameBorderStyle = 'single' | 'double' | 'rounded' | 'bold';

export interface PanelFrameOptions {
  readonly width: number;
  readonly height: number;
  readonly title: string;
  readonly icon?: string;
  readonly focused?: boolean;
  readonly borderStyle?: PanelFrameBorderStyle;
  /** Style function for the border characters. */
  readonly borderColor?: (text: string) => string;
  /** Style function for the title text. */
  readonly titleColor?: (text: string) => string;
  /** Style function for the icon. */
  readonly iconColor?: (text: string) => string;
  /** Content lines (already sized to fit inside the frame). */
  readonly content: readonly string[];
}

// ---------------------------------------------------------------------------
// Border character sets
// ---------------------------------------------------------------------------

interface BorderChars {
  readonly topLeft: string;
  readonly topRight: string;
  readonly bottomLeft: string;
  readonly bottomRight: string;
  readonly horizontal: string;
  readonly vertical: string;
}

const BORDER_CHARS: Record<PanelFrameBorderStyle, BorderChars> = {
  single: {
    topLeft: '┌',
    topRight: '┐',
    bottomLeft: '└',
    bottomRight: '┘',
    horizontal: '─',
    vertical: '│',
  },
  double: {
    topLeft: '╔',
    topRight: '╗',
    bottomLeft: '╚',
    bottomRight: '╝',
    horizontal: '═',
    vertical: '║',
  },
  rounded: {
    topLeft: '╭',
    topRight: '╮',
    bottomLeft: '╰',
    bottomRight: '╯',
    horizontal: '─',
    vertical: '│',
  },
  bold: {
    topLeft: '┏',
    topRight: '┓',
    bottomLeft: '┗',
    bottomRight: '┛',
    horizontal: '━',
    vertical: '┃',
  },
};

// ---------------------------------------------------------------------------
// Panel frame rendering
// ---------------------------------------------------------------------------

/**
 * Renders a panel frame with border, title bar, and content.
 * Returns an array of strings, each exactly `width` characters wide.
 * Total height = `height` lines.
 */
export function renderPanelFrame(options: PanelFrameOptions): string[] {
  const { width, height, title, icon, focused = false } = options;
  const borderKind = options.borderStyle ?? 'rounded';
  const chars = BORDER_CHARS[borderKind];

  if (width < 3 || height < 2) {
    return Array.from({ length: Math.max(0, height) }, () => ''.padEnd(width));
  }

  const borderColor = options.borderColor ?? ((t: string) => t);
  const titleColor = options.titleColor ?? ((t: string) => t);
  const iconColor = options.iconColor ?? ((t: string) => t);

  const rows: string[] = [];

  // Top border with title
  rows.push(renderTitleBar(width, title, icon, focused, chars, borderColor, titleColor, iconColor));

  // Content rows
  const contentHeight = height - 2; // minus top and bottom border
  const contentWidth = width - 2; // minus left and right border
  const vert = borderColor(chars.vertical);

  for (let i = 0; i < contentHeight; i++) {
    const line = options.content[i] ?? '';
    // truncateToWidth with pad=true is ANSI-aware (visible width). Byte-wise
    // slice/padEnd cut mid-SGR and left `38;2…` litter in dock panels.
    const padded = truncateToWidth(line, contentWidth, '', true);
    rows.push(`${vert}${padded}${vert}`);
  }

  // Bottom border
  const bottomBorder = `${borderColor(chars.bottomLeft)}${borderColor(chars.horizontal.repeat(width - 2))}${borderColor(chars.bottomRight)}`;
  rows.push(bottomBorder);

  return rows;
}

function renderTitleBar(
  width: number,
  title: string,
  icon: string | undefined,
  focused: boolean,
  chars: BorderChars,
  borderColor: (t: string) => string,
  titleColor: (t: string) => string,
  iconColor: (t: string) => string,
): string {
  const innerWidth = width - 2;
  const focusIndicator = focused ? '●' : '○';
  const iconPart = icon ? `${iconColor(icon)} ` : '';
  const titleText = `${iconPart}${titleColor(title)}`;
  const focusPart = ` ${focusIndicator}`;

  // Prefer visible width so emoji icons (💬, 📁) don't under-count fill dashes.
  const visibleTitleLen = visibleWidth(`${icon ? `${icon} ` : ''}${title}`);
  const visibleFocusLen = 2;
  const remainingDash = Math.max(0, innerWidth - visibleTitleLen - visibleFocusLen - 1);

  const dashFill = borderColor(chars.horizontal.repeat(remainingDash));

  // Do not padEnd/slice by byte length — that truncates mid-ANSI on styled titles.
  return `${borderColor(chars.topLeft)}${titleText}${dashFill}${focusPart}${borderColor(chars.topRight)}`;
}

// ---------------------------------------------------------------------------
// Panel border hit-test
// ---------------------------------------------------------------------------

/**
 * Determines which zone of a panel rect a point falls in.
 * The border is 1 cell wide on each side.
 * The title bar is the top row inside the border.
 */
export function hitTestPanelBorder(
  x: number,
  y: number,
  panelRect: RendererRect,
): PanelBorderZone {
  const { x: px, y: py, width: pw, height: ph } = panelRect;

  // Outside panel
  if (x < px || x >= px + pw || y < py || y >= py + ph) {
    return 'none';
  }

  const relX = x - px;
  const relY = y - py;

  const onLeft = relX === 0;
  const onRight = relX === pw - 1;
  const onTop = relY === 0;
  const onBottom = relY === ph - 1;

  // Corners
  if (onTop && onLeft) return 'resize-top-left';
  if (onTop && onRight) return 'resize-top-right';
  if (onBottom && onLeft) return 'resize-bottom-left';
  if (onBottom && onRight) return 'resize-bottom-right';

  // Edges
  if (onLeft) return 'resize-left';
  if (onRight) return 'resize-right';
  if (onTop) return 'title-bar'; // Top border doubles as title bar / drag handle
  if (onBottom) return 'resize-bottom';

  return 'body';
}

/**
 * Returns true if the zone is a resize handle.
 */
export function isResizeZone(zone: PanelBorderZone): boolean {
  return zone.startsWith('resize-');
}

/**
 * Returns true if the zone is a drag handle (title bar).
 */
export function isDragZone(zone: PanelBorderZone): boolean {
  return zone === 'title-bar';
}

// ---------------------------------------------------------------------------
// Dock divider hit-test (for resizing dock width)
// ---------------------------------------------------------------------------

export type DockDividerZone = 'left-dock-divider' | 'right-dock-divider' | 'none';

/**
 * Tests if a point is on the divider between a dock and center.
 * The divider is the 1-cell column at the dock's inner edge.
 */
export function hitTestDockDivider(
  x: number,
  y: number,
  leftDockRect: RendererRect | undefined,
  rightDockRect: RendererRect | undefined,
  padCols = 1,
): DockDividerZone {
  const pad = Math.max(0, padCols);
  if (leftDockRect) {
    const seam = leftDockRect.x + leftDockRect.width;
    const inY = y >= leftDockRect.y && y < leftDockRect.y + leftDockRect.height;
    if (inY && x >= seam - pad && x <= seam + pad) return 'left-dock-divider';
  }
  if (rightDockRect) {
    const seam = rightDockRect.x - 1;
    const inY = y >= rightDockRect.y && y < rightDockRect.y + rightDockRect.height;
    if (inY && x >= seam - pad && x <= seam + pad) return 'right-dock-divider';
  }
  return 'none';
}

