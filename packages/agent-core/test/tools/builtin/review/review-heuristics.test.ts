import { describe, expect, it } from 'vitest';

import { scanAddedLine, scanDiffFile } from '../../../../src/tools/builtin/review/review-heuristics';

describe('LioraReview heuristics', () => {
  it('flags TODO/FIXME, empty catch, and console.log', () => {
    expect(scanAddedLine('a.ts', 1, '  // TODO: handle error').map((c) => c.message)).toEqual([
      'Unresolved TODO/FIXME marker introduced in this change.',
    ]);
    expect(scanAddedLine('a.ts', 2, '  } catch (error) {}').some((c) => c.severity === 'warning')).toBe(
      true,
    );
    expect(scanAddedLine('a.ts', 3, '  console.log(x);').length).toBe(1);
  });

  it('flags debugger, secrets, any escapes, and suppressions', () => {
    const debuggerHits = scanAddedLine('a.ts', 4, '  debugger;');
    expect(debuggerHits[0]?.severity).toBe('error');

    const secretHits = scanAddedLine('a.ts', 5, '  const apiKey = "sk-live-super-secret-token";');
    expect(secretHits.some((c) => c.message.includes('secret'))).toBe(true);

    const anyHits = scanAddedLine('a.ts', 6, '  const x = value as any;');
    expect(anyHits[0]?.message).toContain('any type escape');

    const suppress = scanAddedLine('a.ts', 7, '  // @ts-ignore intentional');
    expect(suppress[0]?.message).toContain('suppression');
  });

  it('scans only added lines in a file', () => {
    const comments = scanDiffFile({
      newPath: 'src/x.ts',
      hunks: [
        {
          lines: [
            { type: 'context', newLineNo: 1, text: ' function f() {' },
            { type: 'remove', newLineNo: null, text: '-  return 1;' },
            { type: 'add', newLineNo: 2, text: '+  debugger;' },
            { type: 'add', newLineNo: 3, text: '+  return 2;' },
          ],
        },
      ],
    });
    expect(comments).toHaveLength(1);
    expect(comments[0]?.line).toBe(2);
    expect(comments[0]?.path).toBe('src/x.ts');
  });
});
