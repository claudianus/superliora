import { describe, expect, it } from 'vitest';

import { visibleWidth } from '#/tui/renderer';
import {
  clipCompactTranscriptRows,
  compactHeaderRowCount,
  compactToolVerb,
  composeCompactActivityHeader,
  formatCompactChainMetrics,
  formatCompactThinkingLabel,
  isCompactQuietChrome,
  usesCompactNarrativeHeader,
} from '#/tui/features/transcript/compact-activity';
import { createToolChainStats, recordChainTool, settleToolChain } from '#/tui/features/transcript/transcript-density';
import { currentTheme } from '#/tui/theme';
import { darkColors } from '#/tui/theme/colors';

function strip(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('compact activity language', () => {
  it('maps common tools to narrative verbs', () => {
    expect(compactToolVerb('SessionControl', true)).toBe('Managing sessions');
    expect(compactToolVerb('SessionControl', false)).toBe('Managed sessions');
    expect(compactToolVerb('Bash', true)).toBe('Running');
    expect(compactToolVerb('UnknownTool', false)).toBe('UnknownTool');
  });

  it('uses narrative headers for runtime operations unless showing a child card', () => {
    expect(usesCompactNarrativeHeader('Bash', false)).toBe(true);
    expect(usesCompactNarrativeHeader('SessionControl', false)).toBe(true);
    expect(usesCompactNarrativeHeader('SessionControl', true)).toBe(false);
    expect(usesCompactNarrativeHeader('HistoricalTool', false)).toBe(false);
  });

  it('composes a two-line title + metrics header', () => {
    currentTheme.setPalette(darkColors);
    const header = composeCompactActivityHeader({
      toolName: 'Bash',
      entity: 'patch script',
      live: false,
      metrics: ['+12 -3', '2s'],
    });
    const plain = strip(header);
    expect(plain).toContain('Ran');
    expect(plain).toContain('patch script');
    expect(plain).toContain('+12');
    expect(plain).toContain('-3');
    expect(plain).toContain('2s');
    expect(compactHeaderRowCount(header)).toBe(2);
  });

  it('stays one line when there are no metrics', () => {
    currentTheme.setPalette(darkColors);
    const header = composeCompactActivityHeader({
      toolName: 'Bash',
      entity: 'cat foo.ts',
      live: true,
    });
    expect(strip(header)).toContain('Running');
    expect(compactHeaderRowCount(header)).toBe(1);
  });

  it('uses quiet thinking copy', () => {
    currentTheme.setPalette(darkColors);
    expect(strip(formatCompactThinkingLabel({ live: true }))).toBe('Thinking…');
    expect(strip(formatCompactThinkingLabel({ live: true, elapsedMs: 4_000 }))).toBe('Thinking… 4s');
    expect(strip(formatCompactThinkingLabel({ live: false, elapsedMs: 800 }))).toBe('Thought briefly');
    expect(strip(formatCompactThinkingLabel({ live: false, elapsedMs: 65_000 }))).toBe(
      'Thought for 1m 5s',
    );
  });

  it('formats chain metrics without phase chrome', () => {
    let stats = createToolChainStats(0);
    stats = recordChainTool(stats, { file: 'a.ts', linesAdded: 10, linesRemoved: 2 });
    stats = recordChainTool(stats, { file: 'b.ts', linesAdded: 2, linesRemoved: 1 });
    expect(formatCompactChainMetrics(stats, { live: true, currentLabel: 'Edit' })).toBe(
      'Edit, 2 tools, 2 files +12 −3',
    );
    stats = settleToolChain(stats, 8_000);
    expect(formatCompactChainMetrics(stats, { live: false })).toBe('2 tools, 2 files, 8s +12 −3');
  });

  it('marks only compact as quiet chrome', () => {
    expect(isCompactQuietChrome('compact')).toBe(true);
    expect(isCompactQuietChrome('minimal')).toBe(false);
    expect(isCompactQuietChrome('standard')).toBe(false);
  });

  it('clips compact rows to display width and keeps blank spacers', () => {
    const long = `${'word '.repeat(40)}end`;
    const clipped = clipCompactTranscriptRows(['', long, 'ok'], 20);
    expect(clipped[0]).toBe('');
    expect(visibleWidth(clipped[1]!)).toBeLessThanOrEqual(20);
    expect(clipped[2]).toBe('ok');
  });
});
