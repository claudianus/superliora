import { describe, expect, it } from 'vitest';
import { NativeInputRouter } from '@harness-kit/tui-renderer';
import type { NativeInputEvent } from '@harness-kit/tui-renderer';

import { PanelManager } from '#/tui/workspace/panel-manager';
import { WorkspaceController } from '#/tui/workspace/workspace-controller';
import type { PanelDefinition } from '#/tui/workspace/panel-definition';

// Narrow viewport: below `DEFAULT_MEDIUM_BREAKPOINT` (120 cols), so both
// docks are structurally omitted from the measured layout.
const NARROW_CTX = { terminalColumns: 100, terminalRows: 40 };

const stubPanel: PanelDefinition = {
  id: 'stub',
  title: 'Stub',
  icon: '',
  minWidth: 10,
  minHeight: 5,
  render: () => [],
};

function makeNarrowController(): WorkspaceController {
  const panelManager = new PanelManager({ leftDockVisible: true });
  const instanceId = panelManager.registerPanel(stubPanel);
  panelManager.assignToDock(instanceId, 'left');

  return new WorkspaceController({
    panelManager,
    inputRouter: new NativeInputRouter(),
    requestRender: () => {},
  });
}

const CTRL_B: NativeInputEvent = { type: 'key', key: 'character', text: 'b', ctrl: true } as NativeInputEvent;

describe('WorkspaceController narrow-mode dock toggle', () => {
  it('opens the left drawer on the first Ctrl+B press below the breakpoint', () => {
    // Narrow measurement still publishes a center-only layout (full-bleed
    // bento), but no left dock until the user forces the drawer.
    const controller = makeNarrowController();

    const before = controller.computeLayout(NARROW_CTX);
    expect(before).not.toBeNull();
    expect(before?.leftDock).toBeUndefined();

    const handled = controller.handlePanelShortcut(CTRL_B);
    expect(handled).toBe(true);

    const layout = controller.computeLayout(NARROW_CTX);
    expect(layout).not.toBeNull();
    expect(layout?.leftDock).toBeDefined();
  });
});

describe('WorkspaceController maximize bento paint', () => {
  it('paints a full-shell bento tile when a panel is maximized', () => {
    const panelManager = new PanelManager({ leftDockVisible: true });
    const instanceId = panelManager.registerPanel({
      ...stubPanel,
      render: (w, h) => Array.from({ length: h }, () => 'x'.repeat(Math.max(0, w))),
    });
    panelManager.assignToDock(instanceId, 'left');
    panelManager.focusPanel(instanceId);

    const controller = new WorkspaceController({
      panelManager,
      inputRouter: new NativeInputRouter(),
      requestRender: () => {},
    });

    const layout = controller.computeLayout({ terminalColumns: 160, terminalRows: 40 });
    expect(layout).not.toBeNull();

    // Toggle maximize via the same path Ctrl+M uses.
    (controller as unknown as { maximizedPanelId: string | null }).maximizedPanelId = instanceId;
    expect(controller.getMaximizedPanelId()).toBe(instanceId);

    const writes: string[] = [];
    const frame = {
      writeAnsiText: (_x: number, _y: number, text: string) => {
        writes.push(text);
      },
    };

    const painted = controller.paintMaximizedPanel(
      frame as never,
      layout!,
    );
    expect(painted).toBe(true);
    const joined = writes.join('\n').replaceAll(/\u001B\[[0-9;]*m/g, '');
    expect(joined).toContain('╭');
    expect(joined).toContain('Stub');
    expect(joined).toContain('전체화면');
  });
});
