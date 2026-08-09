import { describe, expect, it } from 'vitest';

import {
  buildDenseContent,
  clampWorkerScrollOffset,
  compactElapsed,
  formatRateSparkline,
  shortModelAlias,
  shouldUseDensemode,
} from '#/tui/components/panes/mission-control/densemode';
import type { MissionWorker } from '#/tui/controllers/mission-control/registry';
import type { AppearancePreferences } from '#/tui/config';

function worker(id: string, spawnedAtMs = 0): MissionWorker {
  return {
    id,
    name: id,
    kind: 'subagent',
    status: 'running',
    runInBackground: false,
    toolCount: 0,
    tokens: 0,
    elapsedMs: 0,
    spawnedAtMs,
    lastActivityAtMs: 0,
  };
}

const OFF_APPEARANCE = { profile: 'off' } as AppearancePreferences;

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

  it('windows the worker roster and reports overflow with a scroll hint', () => {
    const workers = Array.from({ length: 7 }, (_, i) => worker(`w${String(i)}`, i));
    const base = {
      workers,
      ops: [],
      width: 100,
      budget: 14,
      now: 1_000,
      workDir: undefined,
      animated: false,
      appearance: OFF_APPEARANCE,
      revealedLive: new Map<string, string>(),
      displayRate: new Map<string, number>(),
      workerGlyph: () => '◆',
    };
    const page0 = buildDenseContent({ ...base, scrollOffset: 0 });
    const joined0 = page0.lines.join('\n');
    expect(joined0).toContain('w0');
    expect(joined0).toContain('w4');
    expect(joined0).not.toContain('w5');
    expect(joined0).toMatch(/\+2 more \(↑↓\)/);
    expect(page0.workerSlots).toBe(5);
    expect(page0.scrollOffset).toBe(0);

    const page1 = buildDenseContent({ ...base, scrollOffset: 2 });
    const joined1 = page1.lines.join('\n');
    expect(joined1).toContain('w2');
    expect(joined1).toContain('w6');
    expect(joined1).not.toContain('w0');
    expect(page1.scrollOffset).toBe(2);
    expect(clampWorkerScrollOffset(99, 7, 5)).toBe(2);
  });
});
