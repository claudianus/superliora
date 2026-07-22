import { describe, expect, it } from 'vitest';
import { measureWorkspaceLayout } from '@harness-kit/tui-renderer';

import { workspaceShellChromeCells } from '#/tui/workspace/shell-chrome';

describe('workspaceShellChromeCells', () => {
  it('paints shell corners on the inset shell rect', () => {
    const layout = measureWorkspaceLayout({
      viewport: { x: 0, y: 0, width: 200, height: 50 },
    });
    const cells = workspaceShellChromeCells(layout.shell);
    const corners = cells.filter((c) => '╭╮╰╯'.includes(c.char));
    expect(corners.some((c) => c.x === layout.shell.x && c.y === layout.shell.y)).toBe(true);
    expect(corners.every((c) => c.x > 0 && c.y > 0)).toBe(true);
  });

  it('draws exactly one rounded corner glyph at each of the four shell corners', () => {
    const shell = { x: 2, y: 1, width: 20, height: 10 };
    const cells = workspaceShellChromeCells(shell);
    const right = shell.x + shell.width - 1;
    const bottom = shell.y + shell.height - 1;
    expect(cells.find((c) => c.x === shell.x && c.y === shell.y)?.char).toBe('╭');
    expect(cells.find((c) => c.x === right && c.y === shell.y)?.char).toBe('╮');
    expect(cells.find((c) => c.x === shell.x && c.y === bottom)?.char).toBe('╰');
    expect(cells.find((c) => c.x === right && c.y === bottom)?.char).toBe('╯');
  });

  it('draws horizontal and vertical edges only on the perimeter, never inside', () => {
    const shell = { x: 0, y: 0, width: 10, height: 6 };
    const cells = workspaceShellChromeCells(shell);
    const right = shell.x + shell.width - 1;
    const bottom = shell.y + shell.height - 1;
    for (const cell of cells) {
      const onLeft = cell.x === shell.x;
      const onRight = cell.x === right;
      const onTop = cell.y === shell.y;
      const onBottom = cell.y === bottom;
      expect(onLeft || onRight || onTop || onBottom).toBe(true);
    }
    // Total perimeter cell count matches a hollow rectangle outline.
    expect(cells.length).toBe(2 * shell.width + 2 * shell.height - 4);
  });

  it('returns no cells for degenerate (too small) rects', () => {
    expect(workspaceShellChromeCells({ x: 0, y: 0, width: 1, height: 1 })).toEqual([]);
    expect(workspaceShellChromeCells({ x: 0, y: 0, width: 0, height: 5 })).toEqual([]);
  });

  it('styles every cell with a theme-driven hex foreground (no chalk named colors)', () => {
    const shell = { x: 0, y: 0, width: 8, height: 5 };
    const cells = workspaceShellChromeCells(shell);
    for (const cell of cells) {
      expect(cell.style?.fg).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});
