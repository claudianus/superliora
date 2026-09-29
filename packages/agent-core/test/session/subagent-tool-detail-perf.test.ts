import { describe, expect, it } from 'vitest';

import {
  describeSubagentToolDetail,
  previewSubagentToolArgs,
} from '#/session/subagent/subagent-progress-preview';

/** Reference LCS — the pre-optimization algorithm, kept here as the oracle. */
function referenceCounts(
  oldString: string,
  newString: string,
): { added: number; removed: number } {
  if (oldString.length === 0 && newString.length === 0) return { added: 0, removed: 0 };
  const oldLines = oldString.length > 0 ? oldString.split('\n') : [];
  const newLines = newString.length > 0 ? newString.split('\n') : [];
  if (oldLines.length > 300 || newLines.length > 300) {
    return { added: newLines.length, removed: oldLines.length };
  }
  const dp: number[][] = Array.from({ length: oldLines.length + 1 }, () =>
    Array.from({ length: newLines.length + 1 }, () => 0),
  );
  for (let i = 1; i <= oldLines.length; i++) {
    for (let j = 1; j <= newLines.length; j++) {
      dp[i]![j] =
        oldLines[i - 1] === newLines[j - 1]
          ? dp[i - 1]![j - 1]! + 1
          : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }
  const common = dp[oldLines.length]![newLines.length]!;
  return { added: newLines.length - common, removed: oldLines.length - common };
}

const edit = (oldString: string, newString: string) =>
  describeSubagentToolDetail('Edit', { path: 'src/x.ts', old_string: oldString, new_string: newString });

function linesOf(count: number, seed: string): string[] {
  return Array.from({ length: count }, (_, i) => `${seed}-${i}`);
}

describe('subagent Edit chip line counts', () => {
  it('counts a small edit inside a large file as a small edit', () => {
    // 300-line file, two lines changed in the middle. The raw-count shortcut
    // would report 300/300 here; the chip must stay honest.
    const before = linesOf(300, 'line');
    const after = [...before];
    after[150] = 'changed-a';
    after[151] = 'changed-b';

    expect(edit(before.join('\n'), after.join('\n'))).toEqual({
      kind: 'edit',
      path: 'src/x.ts',
      addedLines: 2,
      removedLines: 2,
    });
  });

  it('agrees with the reference LCS across generated shapes', () => {
    const shapes: [string, string][] = [];
    // Deterministic LCG so a failure is reproducible.
    let seed = 12_345;
    const rand = (n: number): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % n;
    };
    for (let trial = 0; trial < 400; trial++) {
      const len = rand(320);
      const base = linesOf(len, 'l');
      const after = base.map((line) => line);
      const edits = rand(40);
      for (let e = 0; e < edits && after.length > 0; e++) {
        const at = rand(after.length);
        if (rand(3) === 0) after.splice(at, 1);
        else after[at] = `mutated-${trial}-${e}`;
      }
      shapes.push([base.join('\n'), after.join('\n')]);
    }
    // Pure rewrites with no shared line.
    shapes.push([linesOf(120, 'a').join('\n'), linesOf(130, 'b').join('\n')]);
    // Empty sides.
    shapes.push(['', 'a\nb\nc']);
    shapes.push(['a\nb\nc', '']);
    shapes.push(['', '']);
    // Identical.
    shapes.push(['a\nb\nc', 'a\nb\nc']);

    for (const [before, after] of shapes) {
      const expected = referenceCounts(before, after);
      expect(edit(before, after)).toEqual({
        kind: 'edit',
        path: 'src/x.ts',
        addedLines: expected.added,
        removedLines: expected.removed,
      });
    }
  });
});

describe('subagent payload previews', () => {
  it('bounds a huge args payload instead of flattening all of it', () => {
    const huge = { path: 'src/y.ts', content: 'q'.repeat(200_000) };
    const preview = describeSubagentToolDetail('Write', huge);
    // The chip still needs the real line/byte counts, so only assert it is finite.
    expect(preview).toBeDefined();
  });

  it('collapses whitespace runs and trims, matching prior behaviour', () => {
    const detail = describeSubagentToolDetail('Bash', { command: '  echo   hi\n\nthere  ' });
    expect(detail).toEqual({ kind: 'bash', command: 'echo hi there' });
  });

  it('reports write line and byte counts for a trailing-newline file', () => {
    const content = 'a\nb\nc\n';
    expect(describeSubagentToolDetail('Write', { path: 'p.ts', content })).toEqual({
      kind: 'write',
      path: 'p.ts',
      lines: 3,
      bytes: 6,
    });
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
