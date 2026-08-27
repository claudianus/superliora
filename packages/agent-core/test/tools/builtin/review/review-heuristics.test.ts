import { describe, expect, it } from 'vitest';

import {
  inventoryDiffFile,
  scanAddedLine,
  scanDiffFile,
} from '../../../../src/tools/builtin/review/review-heuristics';

describe('Review mechanical inventory (no regex quality policy)', () => {
  it('does not flag TODO, empty catch, console.log, debugger, secrets, any, or suppressions', () => {
    const samples = [
      '  // TODO: handle error',
      '  } catch (error) {}',
      '  console.log(x);',
      '  debugger;',
      '  const apiKey = "sk-live-super-secret-token";',
      '  const x = value as any;',
      '  // @ts-ignore intentional',
      '  // eslint-disable-next-line no-console',
    ];
    for (const [index, text] of samples.entries()) {
      expect(scanAddedLine('a.ts', index + 1, text)).toEqual([]);
    }
  });

  it('scanDiffFile never emits quality comments on added lines', () => {
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
    expect(comments).toEqual([]);
  });

  it('counts added and removed lines without judging them', () => {
    const inventory = inventoryDiffFile({
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
    expect(inventory).toEqual({ path: 'src/x.ts', added: 2, removed: 1 });
  });
});
