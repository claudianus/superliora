import { describe, expect, it } from 'vitest';

import type { TranscriptEntry, TranscriptEntryKind } from '#/tui/types';
import { collectTranscriptErrors } from '#/tui/utils/transcript-errors';

function entry(
  overrides: Partial<TranscriptEntry> & { id: string; kind: TranscriptEntryKind },
): TranscriptEntry {
  return {
    renderMode: 'plain',
    content: '',
    ...overrides,
  };
}

function toolEntry(
  id: string,
  name: string,
  output: string,
  isError: boolean,
  extra: Partial<TranscriptEntry> = {},
): TranscriptEntry {
  return entry({
    id,
    kind: 'tool_call',
    toolCallData: {
      id: `${id}-call`,
      name,
      args: {},
      result: { tool_call_id: `${id}-call`, output, is_error: isError },
    },
    ...extra,
  });
}

describe('collectTranscriptErrors', () => {
  it('returns an empty list for an empty transcript', () => {
    expect(collectTranscriptErrors([])).toEqual([]);
  });

  it('extracts failed tool calls with tool name and first meaningful output line', () => {
    const entries = [
      entry({ id: 'a', kind: 'assistant', content: 'trying a command' }),
      toolEntry('b', 'Bash', '\n  \ncommand not found: pnpmx\nexit code 127', true),
    ];

    expect(collectTranscriptErrors(entries)).toEqual([
      {
        index: 1,
        entryId: 'b',
        source: 'tool',
        toolName: 'Bash',
        summary: 'command not found: pnpmx',
      },
    ]);
  });

  it('strips ANSI escapes from tool output summaries', () => {
    const entries = [toolEntry('a', 'Edit', '\u001B[31mold_string not found\u001B[0m in file.ts', true)];

    const items = collectTranscriptErrors(entries);
    expect(items).toHaveLength(1);
    expect(items[0]?.summary).toBe('old_string not found in file.ts');
  });

  it('truncates long summaries to 120 characters with an ellipsis', () => {
    const longLine = `E${'x'.repeat(199)}`;
    const entries = [toolEntry('a', 'Bash', longLine, true)];

    const items = collectTranscriptErrors(entries);
    expect(items).toHaveLength(1);
    expect(items[0]?.summary).toHaveLength(120);
    expect(items[0]?.summary.endsWith('…')).toBe(true);
  });

  it('collects error-colored status entries as status errors', () => {
    const entries = [
      entry({ id: 's', kind: 'status', color: 'error', content: 'Error: model quota exhausted' }),
    ];

    expect(collectTranscriptErrors(entries)).toEqual([
      {
        index: 0,
        entryId: 's',
        source: 'status',
        summary: 'Error: model quota exhausted',
      },
    ]);
  });

  it('emits an entry matching both signals once, as a tool error', () => {
    const entries = [
      toolEntry('b', 'Bash', 'boom', true, { color: 'error', content: 'Error: boom' }),
    ];

    const items = collectTranscriptErrors(entries);
    expect(items).toHaveLength(1);
    expect(items[0]?.source).toBe('tool');
    expect(items[0]?.summary).toBe('boom');
  });

  it('ignores successful tool calls and non-error entries', () => {
    const entries = [
      toolEntry('ok', 'Bash', 'all good', false),
      toolEntry('pending', 'Bash', '', false),
      entry({ id: 'plain', kind: 'status', color: 'primary', content: 'working…' }),
      entry({ id: 'text', kind: 'assistant', content: 'Error-looking text is not an error' }),
    ];

    expect(collectTranscriptErrors(entries)).toEqual([]);
  });

  it('preserves transcript order across mixed sources', () => {
    const entries = [
      entry({ id: 'u', kind: 'user', content: 'do the thing' }),
      toolEntry('t1', 'Bash', 'first failure', true),
      entry({ id: 's1', kind: 'status', color: 'error', content: 'status failure' }),
      toolEntry('t2', 'Read', 'second failure', true),
    ];

    const items = collectTranscriptErrors(entries);
    expect(items.map((item) => item.index)).toEqual([1, 2, 3]);
    expect(items.map((item) => item.source)).toEqual(['tool', 'status', 'tool']);
    expect(items.map((item) => item.entryId)).toEqual(['t1', 's1', 't2']);
  });
});
