import {renderRendererFrameRows, truncateToWidth, visibleWidth} from '#/tui/renderer';
import chalk from 'chalk';

import {currentTheme} from '#/tui/theme';
import type { ColorPalette } from '#/tui/theme/colors';

import {Input} from './input';

export const MCP_SERVER_PREFIX = 'mcp:';
export const ELLIPSIS = '…';

export interface PluginsOverviewItem {
  readonly value: string;
  readonly kind: 'plugin' | 'action';
  readonly label: string;
  readonly status?: string;
  readonly description: string;
}

/** Rounded single-line URL input box (DESIGN §9), shared by the marketplace
 * Custom tab and the unified plugins panel. */
export function renderUrlInputBox(
  input: Input,
  focused: boolean,
  width: number,
  colors: ColorPalette,
): string[] {
  input.focused = focused;
  const border = (s: string): string => chalk.hex(colors.primary)(s);
  const boxWidth = Math.max(24, width - 2);
  const innerWidth = Math.max(10, boxWidth - 4);
  const inputLine = input.render(innerWidth)[0] ?? '';
  return renderRendererFrameRows({
    content: [inputLine],
    width: boxWidth,
    height: 3,
    borderKind: 'rounded',
    paddingLeft: 2,
    paddingRight: 0,
    borderStyle: border,
    ellipsis: ELLIPSIS,
  }).map((line) => ` ${line}`);
}

export function sectionLabel(label: string, colors: ColorPalette): string {
  return chalk.hex(colors.textDim).bold(` ${label}`);
}

export function statusStyle(
  item: PluginsOverviewItem,
  colors: ColorPalette,
): (text: string) => string {
  if (item.kind === 'action') return chalk.hex(colors.textDim);
  if (item.status === 'enabled' || item.status === 'installed') return chalk.hex(colors.success);
  if (item.status?.startsWith('install')) return chalk.hex(colors.primary);
  if (item.status === 'disabled') return chalk.hex(colors.textDim);
  if (item.status !== undefined && /^\d/.test(item.status)) return chalk.hex(colors.textDim);
  return chalk.hex(colors.warning);
}

export function mutedHintLine(text: string, colors?: ColorPalette): string {
  if (colors !== undefined) {
    return chalk.hex(colors.textMuted)(text);
  }
  return currentTheme.fg('textMuted', text);
}

export function wrapOverviewDescription(text: string, width: number): string[] {
  const maxWidth = Math.max(1, width);
  const words = text
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (visibleWidth(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current.length > 0) lines.push(current);
    current = visibleWidth(word) <= maxWidth ? word : truncateToWidth(word, maxWidth, ELLIPSIS);
  }

  if (current.length > 0) lines.push(current);
  return lines;
}
