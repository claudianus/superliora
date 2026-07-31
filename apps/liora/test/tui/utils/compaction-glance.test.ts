import { describe, expect, it } from 'vitest';

import {
  buildCompactionSettingsLines,
  formatContextArchiveLine,
  formatLastCompactLine,
  formatMicroCompactionLine,
  resolveLastCompactionFromTranscript,
} from '#/tui/utils/compaction/compaction-glance';

describe('compaction-glance', () => {
  it('formats live archive count from session context', () => {
    expect(
      formatContextArchiveLine({ archiveEntryCount: 3, archiveMaxEntries: 512 }),
    ).toBe('Context archive: 3 entries (max 512) · Expand(id=…) recover');
  });

  it('falls back to soft tip when archive count is unavailable', () => {
    expect(formatContextArchiveLine({})).toContain('(no session)');
  });

  it('resolves last compact tip from transcript compaction markers', () => {
    const last = resolveLastCompactionFromTranscript([
      { kind: 'user', text: 'hi' } as never,
      {
        kind: 'status',
        text: 'done',
        compactionData: { tokensBefore: 120_000, tokensAfter: 45_000, instruction: 'keep tests' },
      } as never,
    ]);
    expect(formatLastCompactLine(last)).toBe('Last compact: 120k → 45k · "keep tests"');
  });

  it('builds settings lines with live session section', () => {
    const lines = buildCompactionSettingsLines({
      thresholds: {
        triggerLine: 'Soft trigger ratio: 0.7',
        asyncLine: 'Async pre-rot ratio: 0.55',
        workingSetLine: 'Working-set cap: balanced',
        keepLine: 'Keep recent: default',
      },
      session: {
        archiveEntryCount: 2,
        archiveMaxEntries: 512,
        lastCompact: { tokensBefore: 90_000, tokensAfter: 40_000 },
        microCompaction: {
          total: 1,
          lastTrigger: 'tool_clear',
          lastContextUsageRatio: 0.62,
        },
        contextUsage: 0.42,
        contextTokens: 105_000,
        maxContextTokens: 256_000,
      },
    });
    const text = lines.join('\n');
    expect(text).toContain('── Session (live) ──');
    expect(text).toContain('Context archive: 2 entries');
    expect(text).toContain('Last compact: 90k → 40k');
    expect(text).toContain('Context usage: 42.0%');
    expect(text).toContain('Micro-compaction: 1 clears · last tool_clear @ 62% ctx');
    expect(text).toContain('context-archive store');
  });

  it('shows micro-compaction soft fallback without session', () => {
    expect(formatMicroCompactionLine(undefined)).toBe('Micro-compaction: (no session data)');
  });
});
