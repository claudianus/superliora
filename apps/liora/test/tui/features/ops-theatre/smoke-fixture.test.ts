import { describe, expect, it } from 'vitest';

import {
  renderOpsTheatreSmokeGrid,
  renderOpsTheatreSmokeSnapshot,
} from '#/tui/features/ops-theatre/smoke-fixture';

describe('renderOpsTheatreSmokeGrid', () => {
  it('includes Mission/Fleet pane headers and representative body lines', () => {
    const grid = renderOpsTheatreSmokeGrid();
    const joined = grid.join('\n');

    expect(joined).toContain('Fleet / Agents');
    expect(joined).toContain('Mission / Goal');
    expect(joined).toContain('Git / Workspace');
    expect(joined).toContain('Runtime Health');

    // SSOT smoke body — fleet workers + goal objective + search cascade.
    expect(joined).toContain('• running main');
    expect(joined).toContain('• idle explore-1');
    expect(joined).toContain('Maker≠Checker');
    expect(joined).toContain('≥2 wasted rounds');
    expect(joined).toContain('Goal: active · Ship Ops Theatre grid');
    expect(joined).toContain('Dual-emit:');
    expect(joined).toContain('Cascade: ch1→ch3→ch4 · hops 2');
    expect(joined).toContain('Freeze: idle');
  });

  it('snapshot includes git pane and intervention tray tips', () => {
    const snapshot = renderOpsTheatreSmokeSnapshot();
    const joined = snapshot.join('\n');

    expect(joined).toContain('Git: main · dirty · 5 files · +12/−3');
    expect(joined).toContain('▼ Intervention tray');
    expect(joined).toContain('Ctrl-S steer mid-turn · /ops auto-refreshes');
  });
});
