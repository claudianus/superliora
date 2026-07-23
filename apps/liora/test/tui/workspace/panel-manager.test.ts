import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LEFT_DOCK_WIDTH,
  DEFAULT_RIGHT_DOCK_WIDTH,
  DOCK_WIDTH_MIN,
} from '@harness-kit/tui-renderer';

import { PanelManager } from '#/tui/workspace/panel-manager';

describe('PanelManager dock sizing', () => {
  it('defaults to spacious widths', () => {
    const pm = new PanelManager();
    expect(pm.getDockWidth('left')).toBe(DEFAULT_LEFT_DOCK_WIDTH);
    expect(pm.getDockWidth('right')).toBe(DEFAULT_RIGHT_DOCK_WIDTH);
  });

  it('defaults left split / right tabbed for bento readability', () => {
    const pm = new PanelManager();
    expect(pm.getDockMode('left')).toBe('split');
    expect(pm.getDockMode('right')).toBe('tabbed');
  });

  it('clamps below DOCK_WIDTH_MIN up to the minimum', () => {
    const pm = new PanelManager();
    pm.setDockWidth('left', 10);
    expect(pm.getDockWidth('left')).toBe(DOCK_WIDTH_MIN);
  });

  it('clamps persisted ultra-narrow docks on load', () => {
    const pm = new PanelManager({ leftDockWidth: 15, rightDockWidth: 15 });
    // Persistence load (layout-persistence.ts) applies saved widths via setDockWidth,
    // so old ultra-narrow values get upgraded to the new minimum on load.
    pm.setDockWidth('left', 15);
    pm.setDockWidth('right', 15);
    expect(pm.getDockWidth('left')).toBe(DOCK_WIDTH_MIN);
    expect(pm.getDockWidth('right')).toBe(DOCK_WIDTH_MIN);
  });

  it('clamps ultra-narrow widths restored via restoreState', () => {
    const pm = new PanelManager();
    pm.restoreState({
      leftDock: [],
      rightDock: [],
      leftDockWidth: 15,
      rightDockWidth: 15,
      leftDockVisible: true,
      rightDockVisible: true,
      leftDockMode: 'split',
      rightDockMode: 'tabbed',
      focusedPanelId: null,
    });
    expect(pm.getDockWidth('left')).toBe(DOCK_WIDTH_MIN);
    expect(pm.getDockWidth('right')).toBe(DOCK_WIDTH_MIN);
  });
});
