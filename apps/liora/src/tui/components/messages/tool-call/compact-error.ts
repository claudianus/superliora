/**
 * One-line density failure punch-through (PREMIUM.md rule 11).
 */

import { Text, truncateToWidth, type Component } from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import type { ToolResultBlockData } from '#/tui/types';

/** Single error line for collapsed density; empty when no error to show. */
export function buildCompactErrorLineComponent(result: ToolResultBlockData | undefined): Component | undefined {
  if (result === undefined || result.is_error !== true) return undefined;
  const firstLine = result.output
    .split('\n')
    .find((line) => line.trim().length > 0);
  if (firstLine === undefined) return undefined;
  const trimmed = firstLine.trim();
  // truncateToWidth is ANSI- and wide-char-aware; a raw code-unit slice could
  // split SGR sequences or surrogate pairs mid-glyph.
  const text = truncateToWidth(trimmed, 120, '…');
  return new Text(currentTheme.fg('error', text), 2, 0);
}
