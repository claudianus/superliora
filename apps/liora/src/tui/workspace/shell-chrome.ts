import type { RendererCellStyle, RendererRect } from '@harness-kit/tui-renderer';

import { currentTheme } from '#/tui/theme';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single perimeter cell for the outer workspace shell frame. */
export interface WorkspaceShellChromeCell {
  readonly x: number;
  readonly y: number;
  readonly char: string;
  readonly style?: RendererCellStyle;
}

// ---------------------------------------------------------------------------
// Chrome computation
// ---------------------------------------------------------------------------

/**
 * Computes the perimeter cells for the outer workspace shell frame — a single
 * rounded border (`╭─╮│╰─╯`, same glyph family as dock/editor panels) drawn
 * around `layout.shell`. Dock panels render their own `renderPanelFrame`
 * border afterward and overwrite their portion of this perimeter, so the
 * outer frame only shows through where no dock covers it (above/below and
 * around the center stage) — giving the workspace one unified border instead
 * of separate floating panels.
 */
export function workspaceShellChromeCells(shell: RendererRect): WorkspaceShellChromeCell[] {
  const { x, y, width, height } = shell;
  if (width < 2 || height < 2) return [];

  const style: RendererCellStyle = { fg: currentTheme.color('border') };
  const right = x + width - 1;
  const bottom = y + height - 1;

  const cells: WorkspaceShellChromeCell[] = [
    { x, y, char: '╭', style },
    { x: right, y, char: '╮', style },
    { x, y: bottom, char: '╰', style },
    { x: right, y: bottom, char: '╯', style },
  ];

  for (let cx = x + 1; cx < right; cx++) {
    cells.push({ x: cx, y, char: '─', style });
    cells.push({ x: cx, y: bottom, char: '─', style });
  }
  for (let cy = y + 1; cy < bottom; cy++) {
    cells.push({ x, y: cy, char: '│', style });
    cells.push({ x: right, y: cy, char: '│', style });
  }

  return cells;
}
