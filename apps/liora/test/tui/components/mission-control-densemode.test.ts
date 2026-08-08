import { describe, expect, it } from 'vitest';

import {
  compactElapsed,
  formatRateSparkline,
  shortModelAlias,
  shouldUseDensemode,
} from '#/tui/components/panes/mission-control/densemode';
import type { MissionWorker } from '#/tui/controllers/mission-control/registry';

function worker(id: string): MissionWorker {
  return {
    id,
    name: id,
    kind: 'subagent',
    status: 'running',
    runInBackground: false,
    toolCount: 0,
    tokens: 0,
    elapsedMs: 0,
    lastActivityAtMs: 0,
  };
}

describe('mission-control densemode helpers', () => {
  it('enables densemode at two workers', () => {
    expect(shouldUseDensemode([worker('a')])).toBe(false);
    expect(shouldUseDensemode([worker('a'), worker('b')])).toBe(true);
  });

  it('renders a sparkline from rate samples', () => {
    expect(formatRateSparkline(undefined, 3)).toBe('···');
    expect(formatRateSparkline([10, 50, 100], 3).length).toBe(3);
    expect(formatRateSparkline([1, 1, 1], 3)).toMatch(/^[▁▂▃▄▅▆▇█·]+$/u);
  });

  it('compacts model aliases and elapsed clocks', () => {
    expect(shortModelAlias('kimi-k2.5')).toBe('kimi-k2…');
    expect(shortModelAlias('gpt')).toBe('gpt');
    expect(compactElapsed(5_000)).toBe('05s');
    expect(compactElapsed(125_000)).toBe('2m05');
  });
});
