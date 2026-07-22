import { describe, expect, it } from 'vitest';
import type { WorkspaceLayoutResult } from '@harness-kit/tui-renderer';

import { PanelManager } from '#/tui/workspace/panel-manager';
import type { PanelDefinition } from '#/tui/workspace/panel-definition';
import {
  hitTestPanelAt,
  hitTestPanelTitleBarAt,
  resolveWheelTargetPanel,
} from '#/tui/workspace/pointer-routing';

function makePanelDefinition(id: string): PanelDefinition {
  return {
    id,
    title: id,
    icon: '',
    minWidth: 10,
    minHeight: 3,
    render: () => [],
  };
}

/** Two panels stacked in the right dock, split evenly across the dock rect. */
function makeStackedRightDockLayout(): { layout: WorkspaceLayoutResult; panelManager: PanelManager; ids: [string, string] } {
  const panelManager = new PanelManager();
  const idA = panelManager.registerPanel(makePanelDefinition('panel-a'));
  const idB = panelManager.registerPanel(makePanelDefinition('panel-b'));
  panelManager.assignToDock(idA, 'right');
  panelManager.assignToDock(idB, 'right');
  panelManager.focusPanel(idA);

  const rightRect = { x: 100, y: 0, width: 40, height: 20 };
  const layout: WorkspaceLayoutResult = {
    mode: 'wide',
    viewport: { x: 0, y: 0, width: 200, height: 20 },
    shell: { x: 0, y: 0, width: 200, height: 20 },
    center: { x: 42, y: 0, width: 58, height: 20 },
    rightDock: { id: 'right', rect: rightRect, width: rightRect.width },
    dockGap: 0,
    shellInsetX: 0,
    shellInsetY: 0,
  };

  return { layout, panelManager, ids: [idA, idB] };
}

describe('resolveWheelTargetPanel', () => {
  it('selects the panel under the wheel, not only the focused panel', () => {
    const { layout, panelManager, ids } = makeStackedRightDockLayout();
    const [idA, idB] = ids;
    // idA is focused, but the pointer is over panel B's row (bottom half of the dock).
    const pointerY = layout.rightDock!.rect.y + Math.floor(layout.rightDock!.rect.height * 0.75);
    const target = resolveWheelTargetPanel(layout, panelManager, layout.rightDock!.rect.x + 5, pointerY);

    expect(panelManager.getFocusedPanelId()).toBe(idA);
    expect(target).toBe(idB);
  });

  it('still resolves the focused panel when the pointer is over its own row', () => {
    const { layout, panelManager, ids } = makeStackedRightDockLayout();
    const [idA] = ids;
    const pointerY = layout.rightDock!.rect.y + 1; // top half -> panel A
    const target = resolveWheelTargetPanel(layout, panelManager, layout.rightDock!.rect.x + 5, pointerY);
    expect(target).toBe(idA);
  });

  it('returns null when the pointer is outside any dock', () => {
    const { layout, panelManager } = makeStackedRightDockLayout();
    const target = resolveWheelTargetPanel(layout, panelManager, layout.center.x + 5, layout.center.y + 1);
    expect(target).toBeNull();
  });
});

describe('hitTestPanelAt', () => {
  it('mirrors resolveWheelTargetPanel for the same point', () => {
    const { layout, panelManager, ids } = makeStackedRightDockLayout();
    const [, idB] = ids;
    const pointerY = layout.rightDock!.rect.y + Math.floor(layout.rightDock!.rect.height * 0.75);
    const x = layout.rightDock!.rect.x + 5;
    expect(hitTestPanelAt(layout, panelManager, x, pointerY)).toBe(idB);
    expect(hitTestPanelAt(layout, panelManager, x, pointerY)).toBe(resolveWheelTargetPanel(layout, panelManager, x, pointerY));
  });
});

describe('hitTestPanelTitleBarAt', () => {
  it('hits the title-bar row across the full dock width, not just the glyph width', () => {
    const { layout, panelManager, ids } = makeStackedRightDockLayout();
    const [idA] = ids;
    const dockRect = layout.rightDock!.rect;
    const titleRowY = dockRect.y; // row 0 of the first stacked panel slot

    // Leftmost and rightmost columns of the dock row should both hit the title bar.
    expect(hitTestPanelTitleBarAt(layout, panelManager, dockRect.x, titleRowY)).toBe(idA);
    expect(hitTestPanelTitleBarAt(layout, panelManager, dockRect.x + dockRect.width - 1, titleRowY)).toBe(idA);
  });

  it('returns null off the title row (inside the panel body)', () => {
    const { layout, panelManager } = makeStackedRightDockLayout();
    const dockRect = layout.rightDock!.rect;
    expect(hitTestPanelTitleBarAt(layout, panelManager, dockRect.x, dockRect.y + 1)).toBeNull();
  });
});
