import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DOCK_GAP,
  DEFAULT_LEFT_DOCK_WIDTH,
  DEFAULT_RIGHT_DOCK_WIDTH,
  DEFAULT_SHELL_INSET_X,
  DEFAULT_SHELL_INSET_Y,
  measureBentoGridLayout,
  measureWorkspaceLayout,
} from '../src/workspace-layout';

describe('measureWorkspaceLayout shell', () => {
  it('insets a shell and gaps columns in wide mode', () => {
    const layout = measureWorkspaceLayout({
      viewport: { x: 0, y: 0, width: 200, height: 50 },
      leftDockWidth: DEFAULT_LEFT_DOCK_WIDTH,
      rightDockWidth: DEFAULT_RIGHT_DOCK_WIDTH,
    });
    expect(layout.mode).toBe('wide');
    expect(layout.shellInsetX).toBe(DEFAULT_SHELL_INSET_X);
    expect(layout.shellInsetY).toBe(DEFAULT_SHELL_INSET_Y);
    expect(layout.dockGap).toBe(DEFAULT_DOCK_GAP);
    expect(layout.shell).toEqual({
      x: DEFAULT_SHELL_INSET_X,
      y: DEFAULT_SHELL_INSET_Y,
      width: 200 - DEFAULT_SHELL_INSET_X * 2,
      height: 50 - DEFAULT_SHELL_INSET_Y * 2,
    });
    expect(layout.leftDock!.rect.x).toBe(layout.shell.x);
    expect(layout.leftDock!.rect.y).toBe(layout.shell.y);
    // gap between left and center
    expect(layout.center.x).toBe(
      layout.leftDock!.rect.x + layout.leftDock!.rect.width + DEFAULT_DOCK_GAP,
    );
    // docks no longer flush to viewport edges
    expect(layout.leftDock!.rect.x).toBeGreaterThan(0);
    expect(
      layout.rightDock!.rect.x + layout.rightDock!.rect.width,
    ).toBeLessThan(200);
  });

  it('collapses to narrow without docks below medium breakpoint', () => {
    const layout = measureWorkspaceLayout({
      viewport: { x: 0, y: 0, width: 100, height: 40 },
    });
    expect(layout.mode).toBe('narrow');
    expect(layout.leftDock).toBeUndefined();
    expect(layout.rightDock).toBeUndefined();
    expect(layout.center).toEqual(layout.shell);
  });

  it('uses spacious default widths when omitted', () => {
    const layout = measureWorkspaceLayout({
      viewport: { x: 0, y: 0, width: 200, height: 50 },
    });
    expect(layout.leftDock!.width).toBe(DEFAULT_LEFT_DOCK_WIDTH);
    expect(layout.rightDock!.width).toBe(DEFAULT_RIGHT_DOCK_WIDTH);
  });

  it('preserves ultrawide mode (not collapsed to wide) at the ultrawide breakpoint', () => {
    const layout = measureWorkspaceLayout({
      viewport: { x: 0, y: 0, width: 220, height: 50 },
    });
    expect(layout.mode).toBe('ultrawide');
    expect(layout.dockGap).toBe(2);
    expect(layout.leftDock!.width).toBe(48);
    expect(layout.rightDock!.width).toBe(56);
  });

  it('promotes factory default dock widths on ultrawide', () => {
    const layout = measureWorkspaceLayout({
      viewport: { x: 0, y: 0, width: 220, height: 50 },
      leftDockWidth: DEFAULT_LEFT_DOCK_WIDTH,
      rightDockWidth: DEFAULT_RIGHT_DOCK_WIDTH,
    });
    expect(layout.mode).toBe('ultrawide');
    expect(layout.leftDock!.width).toBe(48);
    expect(layout.rightDock!.width).toBe(56);
  });

  it('keeps custom dock widths on ultrawide', () => {
    const layout = measureWorkspaceLayout({
      viewport: { x: 0, y: 0, width: 220, height: 50 },
      leftDockWidth: 36,
      rightDockWidth: 40,
    });
    expect(layout.leftDock!.width).toBe(36);
    expect(layout.rightDock!.width).toBe(40);
  });
});

describe('measureWorkspaceLayout forced drawer', () => {
  it('narrow + drawerDock right + rightDockVisible shows an inset drawer rect', () => {
    const layout = measureWorkspaceLayout({
      viewport: { x: 0, y: 0, width: 100, height: 40 },
      drawerDock: 'right',
    });
    expect(layout.mode).toBe('narrow');
    // center stays the full shell — the drawer floats over it, not beside it.
    expect(layout.center).toEqual(layout.shell);
    expect(layout.leftDock).toBeUndefined();
    expect(layout.rightDock).toBeDefined();
    const rect = layout.rightDock!.rect;
    expect(rect.height).toBe(layout.shell.height);
    expect(rect.y).toBe(layout.shell.y);
    // flush to the shell's right edge (no gap for an overlay drawer).
    expect(rect.x + rect.width).toBe(layout.shell.x + layout.shell.width);
    expect(rect.width).toBe(Math.min(DEFAULT_RIGHT_DOCK_WIDTH, layout.shell.width - 4));
  });

  it('narrow + drawerDock left + leftDockVisible shows an inset drawer rect', () => {
    const layout = measureWorkspaceLayout({
      viewport: { x: 0, y: 0, width: 100, height: 40 },
      drawerDock: 'left',
    });
    expect(layout.mode).toBe('narrow');
    expect(layout.leftDock).toBeDefined();
    expect(layout.rightDock).toBeUndefined();
    const rect = layout.leftDock!.rect;
    // flush to the shell's left edge.
    expect(rect.x).toBe(layout.shell.x);
    expect(rect.width).toBe(Math.min(DEFAULT_LEFT_DOCK_WIDTH, layout.shell.width - 4));
  });

  it('narrow without drawerDock still shows no docks (unchanged default)', () => {
    const layout = measureWorkspaceLayout({
      viewport: { x: 0, y: 0, width: 100, height: 40 },
    });
    expect(layout.leftDock).toBeUndefined();
    expect(layout.rightDock).toBeUndefined();
  });

  it('narrow + drawerDock right but rightDockVisible false shows no drawer', () => {
    const layout = measureWorkspaceLayout({
      viewport: { x: 0, y: 0, width: 100, height: 40 },
      drawerDock: 'right',
      rightDockVisible: false,
    });
    expect(layout.rightDock).toBeUndefined();
    expect(layout.center).toEqual(layout.shell);
  });

  it('wide mode starts at 140 cols so laptop widths get both docks', () => {
    const layout = measureWorkspaceLayout({
      viewport: { x: 0, y: 0, width: 140, height: 40 },
    });
    expect(layout.mode).toBe('wide');
    expect(layout.leftDock).toBeDefined();
    expect(layout.rightDock).toBeDefined();
    expect(layout.center.width).toBeGreaterThanOrEqual(40);
  });

  it('medium + drawerDock left + leftDockVisible overlays left drawer without disturbing the structural right dock', () => {
    const layout = measureWorkspaceLayout({
      viewport: { x: 0, y: 0, width: 130, height: 40 },
      drawerDock: 'left',
    });
    expect(layout.mode).toBe('medium');
    // Right dock still shows structurally (rightDockVisible defaults true).
    expect(layout.rightDock).toBeDefined();
    expect(layout.leftDock).toBeDefined();
    const rect = layout.leftDock!.rect;
    expect(rect.x).toBe(layout.shell.x);
    expect(rect.height).toBe(layout.shell.height);
    expect(rect.width).toBe(Math.min(DEFAULT_LEFT_DOCK_WIDTH, layout.shell.width - 4));
  });

  it('medium without drawerDock keeps the existing left-hide behavior', () => {
    const layout = measureWorkspaceLayout({
      viewport: { x: 0, y: 0, width: 130, height: 40 },
    });
    expect(layout.mode).toBe('medium');
    expect(layout.leftDock).toBeUndefined();
    expect(layout.rightDock).toBeDefined();
  });

  it('wide mode ignores drawerDock (docks are already structural)', () => {
    const layout = measureWorkspaceLayout({
      viewport: { x: 0, y: 0, width: 200, height: 50 },
      drawerDock: 'left',
      leftDockVisible: false,
    });
    expect(layout.mode).toBe('wide');
    // leftDockVisible: false means no left dock at all — drawer does not
    // force it back on in wide mode.
    expect(layout.leftDock).toBeUndefined();
  });
});

describe('measureBentoGridLayout dock columns', () => {
  it('stacks panels to fill a tall narrow dock instead of leaving empty rows', () => {
    const dock = { x: 3, y: 1, width: 42, height: 48 };
    const grid = measureBentoGridLayout(
      dock,
      [
        { id: 'files', colSpan: 1, rowSpan: 1, priority: 10 },
        { id: 'git', colSpan: 1, rowSpan: 1, priority: 5 },
        { id: 'sessions', colSpan: 1, rowSpan: 1, priority: 1 },
      ],
      null,
    );
    expect(grid.columns).toBe(1);
    expect(grid.rows).toBe(3);
    expect(grid.cells).toHaveLength(3);
    const bottom = Math.max(...grid.cells.map((c) => c.rect.y + c.rect.height));
    // Nearly fill the dock (inset + last cell bottom ≈ dock bottom).
    expect(bottom).toBeGreaterThanOrEqual(dock.y + dock.height - 3);
    for (const cell of grid.cells) {
      expect(cell.rect.height).toBeGreaterThanOrEqual(14);
    }
  });

  it('splits two dock panels evenly and flush', () => {
    const dock = { x: 2, y: 1, width: 42, height: 40 };
    const grid = measureBentoGridLayout(
      dock,
      [
        { id: 'files', colSpan: 1, rowSpan: 1, priority: 10 },
        { id: 'git', colSpan: 1, rowSpan: 1, priority: 5 },
      ],
      null,
    );
    expect(grid.cells).toHaveLength(2);
    expect(grid.gap).toBe(0);
    const [files, git] = grid.cells;
    expect(files!.id).toBe('files');
    expect(git!.id).toBe('git');
    expect(Math.abs(files!.rect.height - git!.rect.height)).toBeLessThanOrEqual(1);
    expect(files!.rect.y + files!.rect.height).toBe(git!.rect.y);
    expect(git!.rect.y + git!.rect.height).toBe(dock.y + dock.height);
  });
});
