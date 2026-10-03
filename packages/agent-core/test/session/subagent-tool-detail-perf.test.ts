import { describe, expect, it, vi } from 'vitest';
import { utf8Prefix } from '@superliora/protocol';

import {
  describeSubagentToolDetail,
  previewSubagentToolArgs,
  previewSubagentToolResult,
  previewSubagentToolProgress,
} from '#/session/subagent/subagent-progress-preview';


describe('subagent payload previews', () => {

  it('collapses whitespace runs and trims, matching prior behaviour', () => {
    const detail = describeSubagentToolDetail('Bash', { command: '  echo   hi\n\nthere  ' });
    expect(detail).toEqual({ kind: 'bash', command: 'echo hi there' });
  });

  it('keeps SessionControl operation and bounds its selected UI description', () => {
    const detail = describeSubagentToolDetail('SessionControl', {
      operation: 'spawn', description: 'x'.repeat(1000),
    });
    expect(detail).toMatchObject({ kind: 'session', operation: 'spawn' });
    if (detail?.kind !== 'session') throw new Error('Expected session detail');
    expect(Buffer.byteLength(detail.description ?? '')).toBe(120);
  });

});

/**
 * The pre-optimization preview: stringify everything, flatten every whitespace
 * run, then truncate. The lazy path must be byte-identical to it.
 */
function referencePreview(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  let text: string;
  if (typeof value === 'string') text = value;
  else {
    try {
      const json = JSON.stringify(value);
      if (json === undefined) return undefined;
      text = json;
    } catch {
      text = '[unserializable]';
    }
  }
  const flat = text.replaceAll(/\s+/g, ' ').trim();
  if (flat.length === 0) return undefined;
  return utf8Prefix(flat, maxLength) !== flat ? `${utf8Prefix(flat, maxLength - 3)}…` : flat;
}

describe('previewSubagentToolArgs matches the reference flattening', () => {
  it('agrees on small, large, and adversarial payloads', () => {
    let seed = 987_654;
    const rand = (n: number): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % n;
    };
    const alphabet = 'abc \n\t"\\{}[]:,XYZ019';
    const randomString = (len: number): string =>
      Array.from({ length: len }, () => alphabet[rand(alphabet.length)]).join('');

    const cases: unknown[] = [
      'short',
      '   leading and trailing   ',
      randomString(50),
      randomString(400),
      // Straddles the 400-char cut with a whitespace run.
      `${'a'.repeat(390)}   ${'b'.repeat(30)}`,
      `${'a'.repeat(399)}   `,
      'a'.repeat(450),
      // Medium payloads keep the same serialized prefix.
      { path: 'a.ts', lines: 12 },
      { path: 'a.ts', content: randomString(1_800) },
      // Large payloads exercise the bounded walk, including escapes.
      { path: 'a.ts', content: randomString(20_000) },
      { path: 'a.ts', content: 'tab\there', note: 'x'.repeat(9_000) },
      { nested: { deep: { deeper: ['a', 'b', 'c'.repeat(9_000)] } } },
      [1, 2, 3, 'q'.repeat(9_000)],
      [{ k: 'v'.repeat(5_000) }, { k2: 'v2'.repeat(5_000) }],
      {},
      [],
      { empty: '' },
      { num: 42, bool: true, nil: null, arr: [1, [2, [3]]] },
      { uni: '한글'.repeat(2_000) },
      { esc: '\\"\n\t'.repeat(2_000) },
    ];

    for (const value of cases) {
      expect(previewSubagentToolArgs(value)).toBe(referencePreview(value, 400));
    }
  });
});


describe('bounded parent summaries', () => {
  it('serializes only a source-string prefix and never reads the nested tail', () => {
    const source = 'const answer = 42;\n'.repeat(100_000);
    let tailReads = 0;
    const args = {
      content: source,
      get nested() {
        tailReads++;
        throw new Error('Tail must not be visited');
      },
    };
    const stringify = vi.spyOn(JSON, 'stringify');
    let preview: string | undefined;
    let longestString = 0;
    try {
      preview = previewSubagentToolArgs(args);
      longestString = Math.max(...stringify.mock.calls.map(([value]) =>
        typeof value === 'string' ? value.length : 0));
    } finally {
      stringify.mockRestore();
    }
    expect(preview).toBe(referencePreview({ content: source.slice(0, 1_000) }, 400));
    expect(longestString).toBeLessThanOrEqual(465);
    expect(tailReads).toBe(0);
  });

  it('stops a nested traversal once the visible prefix is filled', () => {
    let reads = 0;
    const entries = Array.from({ length: 10_000 }, () => ({
      get value() { reads++; return 1; },
    }));
    const preview = previewSubagentToolResult({ nested: entries });
    expect(preview).toBe(referencePreview({ nested: entries.slice(0, 100) }, 500));
    // The reference reads 100 entries; the preview reads only its prefix.
    expect(reads - 100).toBeLessThan(60);
  });

  it('handles cycles, excessive nesting, throwing accessors, and BigInt safely', () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    let deep: unknown = 1;
    for (let i = 0; i < 10_000; i++) deep = [deep];
    for (const value of [cycle, deep, { get value() { throw new Error('boom'); } }, { value: 1n }]) {
      expect(previewSubagentToolArgs(value)).toBe('[unserializable]');
    }
  });

  it('bounds visits even when omitted properties produce no preview characters', () => {
    let reads = 0;
    const args: Record<string, unknown> = {};
    const readOmitted = (): undefined => { reads++; return undefined; };
    for (let i = 0; i < 10_000; i++) {
      Object.defineProperty(args, `key${i}`, {
        enumerable: true, get: readOmitted,
      });
    }
    expect(previewSubagentToolArgs(args)).toBe('[unserializable]');
    expect(reads).toBeLessThanOrEqual(2_048);
  });

  it('keeps standard small JSON serialization semantics', () => {
    for (const value of [
      { omitted: undefined, fn: () => 1, symbol: Symbol('x'), n: NaN, inf: Infinity },
      [undefined, () => 1, Symbol('x'), NaN],
      { date: new Date('2025-01-01T00:00:00Z'), boxed: new Object(3) },
      { toJSON(key: string) { return { key, text: 'custom' }; } },
      { text: '\uD800😀' },
    ]) {
      expect(previewSubagentToolArgs(value)).toBe(referencePreview(value, 400));
    }
  });

  it('bounds Bash code details and progress chunks while preserving whitespace', () => {
    const command = '  echo\t hi\nthere ' + 'x'.repeat(1_000_000);
    const flat = command.replaceAll(/\s+/g, ' ').trim();
    expect(describeSubagentToolDetail('Bash', { command })).toEqual({
      kind: 'bash', command: flat.slice(0, 117) + '…',
    });
    expect(describeSubagentToolDetail('Bash', { command: '\u00A0 echo\t hi \u00A0' }))
      .toEqual({ kind: 'bash', command: 'echo hi' });
    expect(previewSubagentToolProgress({ kind: 'stdout', text: ' hi\n' }))
      .toEqual({ kind: 'stdout', textPreview: ' hi\n' });
    expect(previewSubagentToolProgress({ kind: 'stdout', text: ' '.repeat(1_000_000) }))
      .toBeUndefined();
    expect(previewSubagentToolProgress({ kind: 'stderr', text: 'x'.repeat(1_000_000) }))
      .toEqual({ kind: 'stderr', textPreview: 'x'.repeat(497) + '…' });
  });
});

describe('UTF-8 preview byte budgets', () => {
  it('bounds source, progress, and detail prefixes including the three-byte ellipsis', () => {
    const values = [
      previewSubagentToolArgs('中'.repeat(1000)),
      previewSubagentToolResult('😀'.repeat(1000)),
      previewSubagentToolProgress({ kind: 'stdout', text: '中😀'.repeat(1000) })?.textPreview,
      previewSubagentToolProgress({ kind: 'status', text: ' 😀\n中 '.repeat(1000) })?.textPreview,
    ];
    for (const [i, value] of values.entries()) {
      expect(value?.isWellFormed()).toBe(true);
      expect(value?.endsWith('…')).toBe(true);
      expect(Buffer.byteLength(value ?? '')).toBeLessThanOrEqual(i === 0 ? 400 : 500);
    }
    expect(values[0]).toBe('中'.repeat(132) + '…');
    expect(values[1]).toBe('😀'.repeat(124) + '…');
    const detail = describeSubagentToolDetail('Bash', { command: '😀'.repeat(1000) });
    expect(detail).toEqual({ kind: 'bash', command: '😀'.repeat(29) + '…' });
    const session = describeSubagentToolDetail('SessionControl', {
      operation: '中'.repeat(1000), description: '😀'.repeat(1000),
    });
    if (session?.kind !== 'session') throw new Error('Expected session detail');
    expect(Buffer.byteLength(session.operation)).toBe(120);
    expect(Buffer.byteLength(session.description ?? '')).toBe(119);
  });

  it('keeps exact byte limits without unnecessary ellipses or split emoji', () => {
    expect(previewSubagentToolArgs('😀'.repeat(100))).toBe('😀'.repeat(100));
    expect(previewSubagentToolResult('😀'.repeat(125))).toBe('😀'.repeat(125));
    expect(previewSubagentToolArgs('x'.repeat(399) + '😀')).toBe('x'.repeat(397) + '…');
    expect(previewSubagentToolArgs('x\uD800')).toBe('x');
  });

  it('caps escaped JSON output bytes, not source characters, without visiting the tail', () => {
    for (const source of ['中😀'.repeat(1000), '\\"\n\t中😀'.repeat(1000)]) {
      const payload = {
        text: source,
        get tail() { throw new Error('Tail must remain unread'); },
      };
      const expected = referencePreview({ text: source }, 400);
      expect(previewSubagentToolArgs(payload)).toBe(expected);
      expect(Buffer.byteLength(expected ?? '')).toBeLessThanOrEqual(400);
      expect(expected?.isWellFormed()).toBe(true);
    }
    expect(previewSubagentToolArgs({ text: '\uD800😀' }))
      .toBe('{"text":"\\ud800😀"}');
  });
});
