import { describe, expect, it } from 'vitest';

import { resolveDockToggleDecision } from '#/tui/workspace/dock-toggle';

describe('resolveDockToggleDecision', () => {
  it('opens the drawer on the first press when narrow hides the dock', () => {
    // Reproduces the HIGH finding: narrow viewport, leftDockVisible=true,
    // lastToggledDock=null — the dock is default-visible but structurally
    // absent from layout. The first press must open the drawer directly
    // rather than flipping visibility off.
    const decision = resolveDockToggleDecision({
      dock: 'left',
      mode: 'narrow',
      isDockVisible: true,
      isDockInLayout: false,
    });
    expect(decision).toEqual({ action: 'open-drawer', lastToggledDock: 'left' });
  });

  it('opens the drawer on the first press when medium hides the left dock', () => {
    const decision = resolveDockToggleDecision({
      dock: 'left',
      mode: 'medium',
      isDockVisible: true,
      isDockInLayout: false,
    });
    expect(decision).toEqual({ action: 'open-drawer', lastToggledDock: 'left' });
  });

  it('opens the right-dock drawer on the first press in narrow mode', () => {
    const decision = resolveDockToggleDecision({
      dock: 'right',
      mode: 'narrow',
      isDockVisible: true,
      isDockInLayout: false,
    });
    expect(decision).toEqual({ action: 'open-drawer', lastToggledDock: 'right' });
  });

  it('closes an open drawer on the second press', () => {
    const decision = resolveDockToggleDecision({
      dock: 'left',
      mode: 'narrow',
      isDockVisible: true,
      isDockInLayout: true,
    });
    expect(decision).toEqual({ action: 'close-drawer', lastToggledDock: null });
  });

  it('falls back to a plain toggle once the dock has been hidden again', () => {
    const decision = resolveDockToggleDecision({
      dock: 'left',
      mode: 'narrow',
      isDockVisible: false,
      isDockInLayout: false,
    });
    expect(decision).toEqual({ action: 'toggle', lastToggledDock: 'left' });
  });

  it('does not treat the right dock as breakpoint-hidden in medium mode', () => {
    // Medium mode shows the right dock structurally — only the left dock is
    // affected. A plain toggle is correct here regardless of layout state.
    const decision = resolveDockToggleDecision({
      dock: 'right',
      mode: 'medium',
      isDockVisible: true,
      isDockInLayout: true,
    });
    expect(decision).toEqual({ action: 'toggle', lastToggledDock: 'right' });
  });

  it('falls back to a plain toggle in wide mode', () => {
    const decision = resolveDockToggleDecision({
      dock: 'left',
      mode: 'wide',
      isDockVisible: true,
      isDockInLayout: true,
    });
    expect(decision).toEqual({ action: 'toggle', lastToggledDock: 'left' });
  });
});
