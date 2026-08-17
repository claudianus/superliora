import { describe, expect, it } from 'vitest';

import {
  createToolChainStats,
  DEFAULT_TRANSCRIPT_DETAIL,
  formatChainLiveSummary,
  formatChainSettledSummary,
  formatDiffChip,
  formatDurationShort,
  formatTranscriptDetailCycleLabel,
  getActiveTranscriptDetail,
  isChainOnlyToolLevel,
  isOneLineToolLevel,
  nextTranscriptDetailLevel,
  recordChainTool,
  resolveTranscriptDetail,
  setActiveTranscriptDetail,
  settleToolChain,
  TRANSCRIPT_DETAIL_LEVELS,
} from '#/tui/features/transcript/transcript-density';

describe('resolveTranscriptDetail', () => {
  it('prefers local override, then temporary full, then configured', () => {
    expect(resolveTranscriptDetail({ configured: 'standard' })).toBe('standard');
    expect(resolveTranscriptDetail({ configured: 'minimal', temporaryFull: true })).toBe('full');
    expect(
      resolveTranscriptDetail({ configured: 'minimal', temporaryFull: true, localOverride: 'compact' }),
    ).toBe('compact');
  });
});

describe('default transcript expansion density', () => {
  it('exports compact as the product default for unset / new sessions', () => {
    expect(DEFAULT_TRANSCRIPT_DETAIL).toBe('compact');
    // Restore the product default after other suites may have mutated the mirror.
    setActiveTranscriptDetail(DEFAULT_TRANSCRIPT_DETAIL);
    expect(getActiveTranscriptDetail()).toBe('compact');
  });

  it('cycles unknown levels from compact (product default), not standard', () => {
    // Cast: nextTranscriptDetailLevel only accepts valid levels at the type level,
    // but the runtime fallback must still start from the product default.
    // From compact: next is standard.
    expect(nextTranscriptDetailLevel('not-a-level' as never)).toBe('standard');
  });
});

describe('isOneLineToolLevel', () => {
  it('collapses bodies only for compact and minimal', () => {
    expect(isOneLineToolLevel('minimal')).toBe(true);
    expect(isOneLineToolLevel('compact')).toBe(true);
    expect(isOneLineToolLevel('standard')).toBe(false);
    expect(isOneLineToolLevel('full')).toBe(false);
  });
});

describe('isChainOnlyToolLevel', () => {
  it('hides individual tool rows only in minimal (not compact)', () => {
    expect(isChainOnlyToolLevel('minimal')).toBe(true);
    expect(isChainOnlyToolLevel('compact')).toBe(false);
    expect(isChainOnlyToolLevel('standard')).toBe(false);
  });
});

describe('active transcript detail session mirror', () => {
  it('round-trips get/set for render-time readers', () => {
    setActiveTranscriptDetail('minimal');
    expect(getActiveTranscriptDetail()).toBe('minimal');
    setActiveTranscriptDetail('standard');
    expect(getActiveTranscriptDetail()).toBe('standard');
  });
});

describe('nextTranscriptDetailLevel (Ctrl+O cycle)', () => {
  it('walks all four levels and wraps', () => {
    expect(nextTranscriptDetailLevel('minimal')).toBe('compact');
    expect(nextTranscriptDetailLevel('compact')).toBe('standard');
    expect(nextTranscriptDetailLevel('standard')).toBe('full');
    expect(nextTranscriptDetailLevel('full')).toBe('minimal');
  });

  it('covers every configured level exactly once per full cycle', () => {
    let level: (typeof TRANSCRIPT_DETAIL_LEVELS)[number] = 'compact';
    const seen = new Set<string>();
    for (let i = 0; i < TRANSCRIPT_DETAIL_LEVELS.length; i++) {
      level = nextTranscriptDetailLevel(level);
      seen.add(level);
    }
    expect(seen.size).toBe(TRANSCRIPT_DETAIL_LEVELS.length);
    expect(level).toBe('compact');
  });

  it('labels each level for the density-cycle toast', () => {
    for (const level of TRANSCRIPT_DETAIL_LEVELS) {
      expect(formatTranscriptDetailCycleLabel(level)).toMatch(/Transcript ·/);
    }
    expect(formatTranscriptDetailCycleLabel('compact')).toBe(
      'Transcript · compact (activity titles · dim metrics · no chrome)',
    );
  });
});

describe('chain stats aggregation', () => {
  it('folds tool records into counts, diffs, and first error', () => {
    let stats = createToolChainStats(1_000);
    stats = recordChainTool(stats, { file: 'a.ts', linesAdded: 40, linesRemoved: 8 });
    stats = recordChainTool(stats, { file: 'b.ts', linesAdded: 2, linesRemoved: 2 });
    stats = recordChainTool(stats, { isError: true, errorText: 'boom\nsecond line' });

    expect(stats.toolCount).toBe(3);
    expect(stats.filesTouched).toBe(2);
    expect(stats.linesAdded).toBe(42);
    expect(stats.linesRemoved).toBe(10);
    expect(stats.failedCount).toBe(1);
    expect(stats.firstError).toBe('boom');
  });

  it('ignores negative diff noise and keeps the first error', () => {
    let stats = createToolChainStats(0);
    stats = recordChainTool(stats, { isError: true, errorText: 'first' });
    stats = recordChainTool(stats, { isError: true, errorText: 'second', linesAdded: -5 });
    expect(stats.firstError).toBe('first');
    expect(stats.linesAdded).toBe(0);
  });
});

describe('formatDurationShort', () => {
  it('renders compact durations', () => {
    expect(formatDurationShort(42_000)).toBe('42s');
    expect(formatDurationShort(604_000)).toBe('10m 4s');
    expect(formatDurationShort(600_000)).toBe('10m');
    expect(formatDurationShort(3_720_000)).toBe('1h 2m');
    expect(formatDurationShort(3_600_000)).toBe('1h');
    expect(formatDurationShort(-5)).toBe('0s');
  });
});

describe('chain summaries', () => {
  it('builds a live summary with label, count, and diff', () => {
    let stats = createToolChainStats(0);
    stats = recordChainTool(stats, { file: 'x.ts', linesAdded: 42, linesRemoved: 10 });
    expect(formatChainLiveSummary(stats, 'Edit src/x.ts')).toBe('⚙ Edit src/x.ts · 1 tool · +42/−10');
    stats = recordChainTool(stats, {});
    expect(formatChainLiveSummary(stats)).toBe('⚙ 2 tools · +42/−10');
  });

  it('builds a settled summary with elapsed time and failures', () => {
    let stats = createToolChainStats(0);
    stats = recordChainTool(stats, { file: 'x.ts', linesAdded: 1 });
    stats = recordChainTool(stats, { isError: true, errorText: 'nope' });
    stats = settleToolChain(stats, 604_000);
    expect(formatChainSettledSummary(stats)).toBe('Worked for 10m 4s · 2 tools · +1/−0 · 1 failed');
  });

  it('omits the diff chip when nothing was edited', () => {
    const stats = settleToolChain(recordChainTool(createToolChainStats(0), {}), 5_000);
    expect(formatDiffChip(stats)).toBeUndefined();
    expect(formatChainSettledSummary(stats)).toBe('Worked for 5s · 1 tool');
  });
});
