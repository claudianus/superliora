import { describe, expect, it } from 'vitest';

import {
  describeSubagentToolDetail,
  previewSubagentToolArgs,
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
    expect(detail?.kind === 'session' ? detail.description?.length : 0).toBe(120);
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
  return flat.length > maxLength ? `${flat.slice(0, maxLength - 1)}…` : flat;
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
      `${'a'.repeat(450)}`,
      // Below the lazy threshold: must stay on the stringify path.
      { path: 'a.ts', lines: 12 },
      { path: 'a.ts', content: randomString(1_800) },
      // Above the threshold: exercises the lazy walk, including escapes.
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
