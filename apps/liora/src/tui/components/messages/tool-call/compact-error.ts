/**
 * One-line density failure punch-through (PREMIUM.md rule 11).
 */

import { Text, type Component } from '#/tui/renderer';
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
  const text = trimmed.length > 120 ? `${trimmed.slice(0, 119)}…` : trimmed;
  return new Text(currentTheme.fg('error', text), 2, 0);
}
