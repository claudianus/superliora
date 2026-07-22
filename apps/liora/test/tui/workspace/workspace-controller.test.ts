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
    // Reproduces the second HIGH regression: `computeLayout` returns null
    // (no docks present) on narrow with nothing toggled yet, which used to
    // make `toggleDockDrawerAware` read `currentLayout?.mode ?? 'wide'` ->
    // always 'wide' -> plain toggle instead of opening the drawer.
    const controller = makeNarrowController();

    // Establish the narrow measurement first, exactly as the real render
    // loop does before any input is handled.
    expect(controller.computeLayout(NARROW_CTX)).toBeNull();

    const handled = controller.handlePanelShortcut(CTRL_B);
    expect(handled).toBe(true);

    const layout = controller.computeLayout(NARROW_CTX);
    expect(layout).not.toBeNull();
    expect(layout?.leftDock).toBeDefined();
  });
});
