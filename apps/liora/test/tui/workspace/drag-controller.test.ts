import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeInputRouter } from '@harness-kit/tui-renderer';
import type { NativeInputMouseEvent, WorkspaceLayoutResult } from '@harness-kit/tui-renderer';

import { DragController } from '#/tui/workspace/drag-controller';
import { PanelManager } from '#/tui/workspace/panel-manager';
import type { PanelDefinition } from '#/tui/workspace/panel-definition';

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

function mouseMove(x: number, y: number): NativeInputMouseEvent {
  return { type: 'mouse', raw: '', button: 'none', action: 'move', x, y, ctrl: false, alt: false, shift: false };
}

describe('DragController idle hover pointer shapes', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;
  let panelManager: PanelManager;
  let layout: WorkspaceLayoutResult;
  let panelInstanceId: string;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    panelManager = new PanelManager();
    panelInstanceId = panelManager.registerPanel(makePanelDefinition('panel-a'));
    panelManager.assignToDock(panelInstanceId, 'right');

    const rightRect = { x: 100, y: 0, width: 40, height: 20 };
    layout = {
      mode: 'wide',
      viewport: { x: 0, y: 0, width: 200, height: 20 },
      shell: { x: 0, y: 0, width: 200, height: 20 },
      center: { x: 42, y: 0, width: 58, height: 20 },
      rightDock: { id: 'right', rect: rightRect, width: rightRect.width },
      dockGap: 0,
      shellInsetX: 0,
      shellInsetY: 0,
    };
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  function attachController(): DragController {
    const controller = new DragController(panelManager, {
      onLayoutChange: () => {},
      getLayout: () => layout,
    });
    controller.attach(new NativeInputRouter());
    return controller;
  }

  it('pushes ew-resize once when hovering the dock divider, without re-pushing on repeated moves', () => {
    const controller = attachController();
    const dividerX = layout.rightDock!.rect.x - 1; // seam column (right-dock-divider)

    // @ts-expect-error -- handleInput is private; test reaches it the same way the router would.
    controller.handleInput(mouseMove(dividerX, 5));
    // @ts-expect-error -- handleInput is private; test reaches it the same way the router would.
    controller.handleInput(mouseMove(dividerX, 6));

    const pushCalls = writeSpy.mock.calls.filter((c: unknown[]) => String(c[0]).includes('22;ew-resize'));
    expect(pushCalls).toHaveLength(1);
  });

  it('pops the divider shape once the pointer moves off the divider into a plain zone', () => {
    const controller = attachController();
    const dividerX = layout.rightDock!.rect.x - 1;

    // @ts-expect-error -- handleInput is private; test reaches it the same way the router would.
    controller.handleInput(mouseMove(dividerX, 5));
    writeSpy.mockClear();

    // Move into the center content area — no divider, title bar, or panel body there.
    // @ts-expect-error -- handleInput is private; test reaches it the same way the router would.
    controller.handleInput(mouseMove(layout.center.x + 5, 5));

    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy).toHaveBeenCalledWith('\u001B[23u');
  });

  it('pushes grab when hovering a panel title bar', () => {
    const controller = attachController();
    const dockRect = layout.rightDock!.rect;

    // @ts-expect-error -- handleInput is private; test reaches it the same way the router would.
    controller.handleInput(mouseMove(dockRect.x + 5, dockRect.y));

    const grabCalls = writeSpy.mock.calls.filter((c: unknown[]) => String(c[0]).includes('22;grab'));
    expect(grabCalls).toHaveLength(1);
  });

  it('pushes pointer when hovering a panel body (not the title row)', () => {
    const controller = attachController();
    const dockRect = layout.rightDock!.rect;

    // @ts-expect-error -- handleInput is private; test reaches it the same way the router would.
    controller.handleInput(mouseMove(dockRect.x + 5, dockRect.y + 3));

    const pointerCalls = writeSpy.mock.calls.filter((c: unknown[]) => String(c[0]).includes('22;pointer'));
    expect(pointerCalls).toHaveLength(1);
  });
});
