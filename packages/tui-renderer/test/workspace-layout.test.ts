import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DOCK_GAP,
  DEFAULT_LEFT_DOCK_WIDTH,
  DEFAULT_RIGHT_DOCK_WIDTH,
  DEFAULT_SHELL_INSET_X,
  DEFAULT_SHELL_INSET_Y,
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
});
