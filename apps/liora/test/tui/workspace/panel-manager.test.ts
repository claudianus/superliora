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

  it('clamps below DOCK_WIDTH_MIN up to the minimum', () => {
    const pm = new PanelManager();
    pm.setDockWidth('left', 10);
    expect(pm.getDockWidth('left')).toBe(DOCK_WIDTH_MIN);
  });
});
