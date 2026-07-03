import { afterEach, describe, expect, it } from 'vitest';

import { measureRendererRegions, Text } from '#/tui/renderer';
import { TranscriptViewportComponent } from '#/tui/components/messages/transcript-viewport';
import type { TranscriptEntry } from '#/tui/types';
import {
  createTranscriptViewportState,
  scrollTranscriptViewport,
  syncTranscriptViewport,
  transcriptViewportStart,
} from '#/tui/utils/transcript-viewport';
import { groupTurns, readEnvInt, turnsToTrim } from '#/tui/utils/transcript-window';

let seq = 0;
function makeEntry(
  turnId: string | undefined,
  kind: TranscriptEntry['kind'] = 'assistant',
): TranscriptEntry {
  return { id: String(++seq), kind, turnId, renderMode: 'markdown', content: '' };
}
function tool(turnId: string): TranscriptEntry {
  return makeEntry(turnId, 'tool_call');
}
function msg(turnId: string | undefined): TranscriptEntry {
  return makeEntry(turnId, 'assistant');
}

function stripAnsi(value: string): string {
  return value.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

describe('groupTurns', () => {
  it('groups consecutive entries with the same turnId', () => {
    const turns = groupTurns([msg('a'), tool('a'), msg('b')]);
    expect(turns.map((t) => t.turnId)).toEqual(['a', 'b']);
    expect(turns[0]!.entries).toHaveLength(2);
    expect(turns[1]!.entries).toHaveLength(1);
  });

  it('attaches leading undefined turnId entries to the following turn', () => {
    // A user message (undefined turnId) followed by its response should be one turn.
    const turns = groupTurns([msg(undefined), tool('1'), msg('1')]);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.turnId).toBe('1');
    expect(turns[0]!.entries).toHaveLength(3);
  });

  it('attaches multiple consecutive undefined entries to the following turn', () => {
    const turns = groupTurns([msg(undefined), msg(undefined), msg('a')]);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.turnId).toBe('a');
    expect(turns[0]!.entries).toHaveLength(3);
  });

  it('makes trailing undefined entries their own turn', () => {
    const turns = groupTurns([msg('a'), msg(undefined)]);
    expect(turns).toHaveLength(2);
    expect(turns[0]!.turnId).toBe('a');
    expect(turns[1]!.turnId).toBeUndefined();
    expect(turns[1]!.entries).toHaveLength(1);
  });
});

describe('turnsToTrim', () => {
  it('returns empty when turn count is within maxTurns', () => {
    const turns = groupTurns([msg('a'), msg('b'), msg('c')]); // 3 turns
    expect(turnsToTrim(turns, 5, 1).size).toBe(0);
  });

  it('does not trim within the hysteresis band', () => {
    const turns = groupTurns([msg('a'), msg('b'), msg('c')]); // 3 turns
    expect(turnsToTrim(turns, 2, 1).size).toBe(0); // 3 <= 2 + 1
  });

  it('trims oldest turns first', () => {
    const entries = [msg('a'), msg('b'), msg('c'), msg('d')]; // 4 turns
    const turns = groupTurns(entries);
    const removed = turnsToTrim(turns, 2, 0);
    expect(removed.has(entries[0]!)).toBe(true);
    expect(removed.has(entries[1]!)).toBe(true);
    expect(removed.has(entries[2]!)).toBe(false);
    expect(removed.has(entries[3]!)).toBe(false);
  });

  it('never trims the most recent turn', () => {
    // A single turn is never removed, even if it is huge.
    const entries = Array.from({ length: 200 }, () => tool('solo'));
    const turns = groupTurns(entries); // 1 turn
    const removed = turnsToTrim(turns, 2, 0);
    expect(removed.size).toBe(0);
  });
});

describe('readEnvInt', () => {
  const KEY = 'KIMI_CODE_TUI_TEST_INT';
  afterEach(() => {
    delete process.env[KEY];
  });

  it('returns fallback when unset', () => {
    expect(readEnvInt(KEY, 7)).toBe(7);
  });

  it('reads a valid integer', () => {
    process.env[KEY] = '42';
    expect(readEnvInt(KEY, 7)).toBe(42);
  });

  it('accepts 0', () => {
    process.env[KEY] = '0';
    expect(readEnvInt(KEY, 7)).toBe(0);
  });

  it('falls back on negative', () => {
    process.env[KEY] = '-1';
    expect(readEnvInt(KEY, 7)).toBe(7);
  });

  it('falls back on non-integer', () => {
    process.env[KEY] = 'abc';
    expect(readEnvInt(KEY, 7)).toBe(7);
  });

  it('falls back on empty/whitespace', () => {
    process.env[KEY] = '  ';
    expect(readEnvInt(KEY, 7)).toBe(7);
  });
});

describe('transcript viewport', () => {
  it('follows output by default', () => {
    const viewport = createTranscriptViewportState();
    syncTranscriptViewport(viewport, 100, 20);

    expect(viewport.followOutput).toBe(true);
    expect(viewport.offsetFromBottom).toBe(0);
    expect(transcriptViewportStart(viewport)).toBe(80);
  });

  it('keeps the same rows visible when output grows while scrolled up', () => {
    const viewport = createTranscriptViewportState();
    syncTranscriptViewport(viewport, 100, 20);

    expect(scrollTranscriptViewport(viewport, 'page-up')).toBe(true);
    expect(viewport.followOutput).toBe(false);
    expect(viewport.offsetFromBottom).toBe(19);
    expect(transcriptViewportStart(viewport)).toBe(61);

    syncTranscriptViewport(viewport, 110, 20);

    expect(viewport.followOutput).toBe(false);
    expect(viewport.offsetFromBottom).toBe(29);
    expect(transcriptViewportStart(viewport)).toBe(61);
  });

  it('keeps manual scrollback mode when output starts shorter than the viewport', () => {
    const viewport = createTranscriptViewportState();
    syncTranscriptViewport(viewport, 3, 5);

    expect(viewport.followOutput).toBe(true);
    expect(scrollTranscriptViewport(viewport, 'line-up')).toBe(true);
    expect(viewport.followOutput).toBe(false);
    expect(viewport.offsetFromBottom).toBe(0);
    expect(transcriptViewportStart(viewport)).toBe(0);

    syncTranscriptViewport(viewport, 10, 5);

    expect(viewport.followOutput).toBe(false);
    expect(viewport.offsetFromBottom).toBe(5);
    expect(transcriptViewportStart(viewport)).toBe(0);
  });

  it('supports line-sized scroll steps for wheel input', () => {
    const viewport = createTranscriptViewportState();
    syncTranscriptViewport(viewport, 100, 20);

    expect(scrollTranscriptViewport(viewport, 'line-up')).toBe(true);
    expect(viewport.followOutput).toBe(false);
    expect(viewport.offsetFromBottom).toBe(3);
    expect(transcriptViewportStart(viewport)).toBe(77);

    expect(scrollTranscriptViewport(viewport, 'line-down')).toBe(true);
    expect(viewport.followOutput).toBe(true);
    expect(viewport.offsetFromBottom).toBe(0);
  });

  it('keeps the same top row visible when region height changes while scrolled up', () => {
    const viewport = createTranscriptViewportState();
    syncTranscriptViewport(viewport, 100, 20);
    scrollTranscriptViewport(viewport, 'page-up');

    syncTranscriptViewport(viewport, 100, 10);

    expect(viewport.followOutput).toBe(false);
    expect(viewport.offsetFromBottom).toBe(29);
    expect(transcriptViewportStart(viewport)).toBe(61);

    syncTranscriptViewport(viewport, 100, 30);

    expect(viewport.followOutput).toBe(false);
    expect(viewport.offsetFromBottom).toBe(9);
    expect(transcriptViewportStart(viewport)).toBe(61);
  });

  it('returns to follow mode at the bottom', () => {
    const viewport = createTranscriptViewportState();
    syncTranscriptViewport(viewport, 100, 20);
    scrollTranscriptViewport(viewport, 'top');

    expect(viewport.followOutput).toBe(false);
    expect(scrollTranscriptViewport(viewport, 'bottom')).toBe(true);
    expect(viewport.followOutput).toBe(true);
    expect(viewport.offsetFromBottom).toBe(0);
  });
});

describe('renderer region layout', () => {
  it('assigns transcript to the terminal rows left after fixed regions', () => {
    const layout = measureRendererRegions({
      terminalRows: 30,
      heights: {
        activity: 2,
        todo: 3,
        queue: 1,
        editor: 4,
        footer: 2,
      },
    });

    expect(layout.reservedRows).toBe(12);
    expect(layout.transcriptRows).toBe(18);
    expect(layout.regions.map((region) => [region.id, region.rows])).toEqual([
      ['transcript', 18],
      ['activity', 2],
      ['todo', 3],
      ['queue', 1],
      ['editor', 4],
      ['footer', 2],
    ]);
    expect(layout.regions.map((region) => [region.id, region.y])).toEqual([
      ['transcript', 0],
      ['activity', 18],
      ['todo', 20],
      ['queue', 23],
      ['editor', 24],
      ['footer', 28],
    ]);
  });

  it('keeps a minimum transcript region when fixed regions fill the terminal', () => {
    const layout = measureRendererRegions({
      terminalRows: 10,
      heights: { editor: 8, footer: 3 },
      minTranscriptRows: 2,
    });

    expect(layout.reservedRows).toBe(11);
    expect(layout.transcriptRows).toBe(2);
  });

  it('treats unknown terminal height as unbounded transcript height', () => {
    const layout = measureRendererRegions({
      terminalRows: 0,
      heights: { editor: 3, footer: 2 },
    });

    expect(layout.transcriptRows).toBe(Number.POSITIVE_INFINITY);
    expect(layout.reservedRows).toBe(0);
  });
});

describe('TranscriptViewportComponent', () => {
  it('renders the bottom of the transcript within the measured visible rows', () => {
    const viewport = createTranscriptViewportState();
    const component = new TranscriptViewportComponent(0, 0, viewport, () => 3);
    component.addChild(new Text(['one', 'two', 'three', 'four', 'five'].join('\n'), 0, 0));

    expect(component.render(80).map((line) => line.trimEnd())).toEqual([
      'three',
      'four',
      'five',
    ]);
  });

  it('renders a right-gutter scrollbar when transcript content overflows', () => {
    const viewport = createTranscriptViewportState();
    const component = new TranscriptViewportComponent(0, 1, viewport, () => 3);
    component.addChild(new Text(['one', 'two', 'three', 'four', 'five'].join('\n'), 0, 0));

    expect(component.render(8).map(stripAnsi)).toEqual([
      'three  │',
      'four   █',
      'five   █',
    ]);
  });

  it('passes render width to the visible row callback', () => {
    const viewport = createTranscriptViewportState();
    let measuredWidth = 0;
    const component = new TranscriptViewportComponent(0, 0, viewport, (width) => {
      measuredWidth = width;
      return 1;
    });
    component.addChild(new Text('one\ntwo', 0, 0));

    component.render(42);

    expect(measuredWidth).toBe(42);
  });
});
