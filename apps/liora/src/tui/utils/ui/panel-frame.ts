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

export interface RenderRoundedPanelOptions {
  readonly title: string;
  readonly content: readonly string[];
  readonly width: number;
  readonly borderToken?: ColorToken;
  readonly leftMargin?: number;
  readonly sidePadding?: number;
  readonly minBoxWidth?: number;
}

function boxOverhead(leftMargin: number, sidePadding: number): number {
  return leftMargin + 2 + 2 * sidePadding;
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
  const contentWidth = Math.max(
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
