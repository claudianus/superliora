import { truncateToWidth, visibleWidth } from '#/tui/renderer';
import chalk from 'chalk';

import { currentTheme } from '#/tui/theme';

export function truncateWithColor(text: string, width: number, color: string): string {
  const colorize = chalk.hex(color);
  return truncateToWidth(colorize(text), width, colorize('…'));
}

export function truncateStartToWidth(text: string, width: number): string {
  if (visibleWidth(text) <= width) return text;
  const ellipsis = '…';
  const ellipsisWidth = visibleWidth(ellipsis);
  if (width <= ellipsisWidth) return truncateToWidth(ellipsis, width);

  const targetWidth = width - ellipsisWidth;
  const segments = Array.from(text);
  let tail = '';
  let tailWidth = 0;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index] ?? '';
    const segmentWidth = visibleWidth(segment);
    if (tailWidth + segmentWidth > targetWidth) break;
    tail = segment + tail;
    tailWidth += segmentWidth;
  }
  return ellipsis + tail;
}

export function collapseWhitespace(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim();
}

export function latestNonEmptyLine(text: string): string {
  const lines = text.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = collapseWhitespace(lines[index] ?? '');
    if (line.length > 0) return line;
  }
  return '';
}

export function padAnsi(text: string, width: number): string {
  const truncated = truncateToWidth(text, width);
  return truncated + ' '.repeat(Math.max(0, width - visibleWidth(truncated)));
}

export function normalizeFinalOutputText(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const normalized = collapseWhitespace(text);
  return normalized.length > 0 ? normalized : undefined;
}
