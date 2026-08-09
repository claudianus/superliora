import {
  fitRendererFrameTitle,
  renderRendererFrameRows,
  truncateToWidth,
  visibleWidth,
} from '#/tui/renderer';

import { currentTheme } from '#/tui/theme';
import type { ColorToken } from '#/tui/theme';

const DEFAULT_LEFT_MARGIN = 0;
const DEFAULT_SIDE_PADDING = 1;
const DEFAULT_MIN_BOX_WIDTH = 24;

/**
 * Shared inset for stacked stage chrome bands (Todo Board, Worker Dock) so
 * their left/right edges paint on the same columns.
 */
export const CHROME_BAND_LEFT_MARGIN = 2;
export const CHROME_BAND_SIDE_PADDING = DEFAULT_SIDE_PADDING;

export interface RenderRoundedPanelOptions {
  readonly title: string;
  readonly content: readonly string[];
  readonly width: number;
  readonly borderToken?: ColorToken;
  readonly leftMargin?: number;
  readonly sidePadding?: number;
  readonly minBoxWidth?: number;
  /**
   * Stretch the frame to the full available width instead of shrink-wrapping
   * to the longest content/title line. Stage chrome bands (Todo Board,
   * Worker Dock) use this so stacked panels share a right edge.
   */
  readonly fillWidth?: boolean;
}

function boxOverhead(leftMargin: number, sidePadding: number): number {
  return leftMargin + 2 + 2 * sidePadding;
}

/** Interior content width for a chrome band framed with {@link renderRoundedPanel}. */
export function chromeBandInteriorWidth(
  width: number,
  leftMargin: number = CHROME_BAND_LEFT_MARGIN,
  sidePadding: number = CHROME_BAND_SIDE_PADDING,
): number {
  return Math.max(1, width - boxOverhead(leftMargin, sidePadding));
}

export function renderRoundedPanel(options: RenderRoundedPanelOptions): string[] {
  const safeWidth = Math.max(0, options.width);
  if (safeWidth <= 0) return [''];

  const leftMargin = options.leftMargin ?? DEFAULT_LEFT_MARGIN;
  const sidePadding = options.sidePadding ?? DEFAULT_SIDE_PADDING;
  const minBoxWidth = options.minBoxWidth ?? DEFAULT_MIN_BOX_WIDTH;
  const borderToken = options.borderToken ?? 'primary';
  const content = options.content.length > 0 ? options.content : [''];
  const indent = ' '.repeat(leftMargin);

  if (safeWidth < minBoxWidth) {
    return content.map((line) => truncateToWidth(indent + line, safeWidth, '…'));
  }

  const paint = (text: string): string => currentTheme.fg(borderToken, text);
  const availableInterior = safeWidth - boxOverhead(leftMargin, sidePadding);
  if (availableInterior < 1) {
    return [
      truncateToWidth(indent + options.title.trim(), safeWidth, '…'),
      ...content.map((line) => truncateToWidth(indent + line, safeWidth, '…')),
    ];
  }

  const longestLine = content.reduce((max, line) => Math.max(max, visibleWidth(line)), 0);
  const contentWidth = options.fillWidth
    ? Math.max(1, availableInterior)
    : Math.max(
        1,
        Math.min(availableInterior, Math.max(longestLine, visibleWidth(options.title))),
      );
  const horzLen = contentWidth + 2 * sidePadding;
  const title = fitRendererFrameTitle(options.title, horzLen, '…');
  const frame = renderRendererFrameRows({
    title,
    titlePlacement: 'flush',
    borderKind: 'rounded',
    content,
    width: horzLen + 2,
    height: content.length + 2,
    paddingX: sidePadding,
    borderStyle: paint,
    titleStyle: paint,
    ellipsis: '…',
  });
  return frame.map((line) => truncateToWidth(indent + line, safeWidth, '…'));
}
