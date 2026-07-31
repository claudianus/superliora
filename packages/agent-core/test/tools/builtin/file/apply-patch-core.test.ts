import { describe, expect, it } from 'vitest';

import {
  applyHunksToContent,
  applyPatchToFileMap,
  parseOpenCodePatch,
} from '#/tools/builtin/file/apply-patch-core';

describe('parseOpenCodePatch', () => {
  it('parses update and add sections', () => {
    const patch = `*** Begin Patch
*** Update File: src/a.ts
@@
-old
+new
*** Add File: src/b.ts
+line1
*** End Patch`;
    const parsed = parseOpenCodePatch(patch);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.files).toHaveLength(2);
    expect(parsed.files[0]?.kind).toBe('update');
    expect(parsed.files[1]?.kind).toBe('add');
  });

  it('rejects patches without Begin marker', () => {
    const parsed = parseOpenCodePatch('*** Update File: x\n@@\n-old\n+new');
    expect(parsed.ok).toBe(false);
  });
});

describe('applyHunksToContent', () => {
  it('replaces a single hunk', () => {
    const content = 'alpha\nbeta\ngamma';
    const result = applyHunksToContent(content, [
      { lines: [{ type: 'remove', text: 'beta' }, { type: 'add', text: 'BETA' }] },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toBe('alpha\nBETA\ngamma');
  });

  it('uses context lines for unique match', () => {
    const content = 'first\nfoo\nkeep\nfoo\n';
    const result = applyHunksToContent(content, [
      {
        lines: [
          { type: 'context', text: 'first' },
          { type: 'remove', text: 'foo' },
          { type: 'add', text: 'bar' },
        ],
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toBe('first\nbar\nkeep\nfoo\n');
  });

  it('errors on ambiguous hunks', () => {
    const result = applyHunksToContent('dup\ndup', [
      { lines: [{ type: 'remove', text: 'dup' }, { type: 'add', text: 'x' }] },
    ]);
    expect(result.ok).toBe(false);
  });
});

describe('applyPatchToFileMap', () => {
  it('applies multi-file updates in memory', () => {
    const files = new Map([
      ['a.ts', 'one'],
      ['b.ts', 'two'],
    ]);
    const parsed = parseOpenCodePatch(`*** Begin Patch
*** Update File: a.ts
@@
-one
+ONE
*** Update File: b.ts
@@
-two
+TWO
*** End Patch`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const applied = applyPatchToFileMap(files, parsed.files);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.updates.get('a.ts')).toBe('ONE');
    expect(applied.updates.get('b.ts')).toBe('TWO');
  });
});
