import { describe, expect, it } from 'vitest';
import { parseDiff, resolveLineBySnippet } from '../../../../src/tools/builtin/review/diff-parser';

const SAMPLE_DIFF = `diff --git a/src/app.ts b/src/app.ts
index 1234567..abcdefg 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,5 +10,8 @@ function main() {
   const x = 1;
-  const y = 2;
+  const y = getValue();
+  console.log(y);
+  // TODO: handle error
   return x + y;
 }`;

describe('parseDiff', () => {
  it('parses a single-file diff with one hunk', () => {
    const files = parseDiff(SAMPLE_DIFF);
    expect(files).toHaveLength(1);
    expect(files[0]?.newPath).toBe('src/app.ts');
    expect(files[0]?.hunks).toHaveLength(1);
  });

  it('extracts add/remove/context lines with line numbers', () => {
    const files = parseDiff(SAMPLE_DIFF);
    const hunk = files[0]!.hunks[0]!;
    const added = hunk.lines.filter((l) => l.type === 'add');
    expect(added).toHaveLength(3);
    expect(added[0]?.newLineNo).toBe(12);
    expect(added[1]?.text).toBe('  console.log(y);');
  });

  it('returns empty for non-diff input', () => {
    expect(parseDiff('hello world')).toEqual([]);
  });
});

describe('resolveLineBySnippet', () => {
  it('finds the new-side line number for a code snippet', () => {
    const files = parseDiff(SAMPLE_DIFF);
    const hunk = files[0]!.hunks[0]!;
    expect(resolveLineBySnippet(hunk, 'console.log(y);')).toBe(13);
    expect(resolveLineBySnippet(hunk, '// TODO: handle error')).toBe(14);
  });

  it('returns null when the snippet is not in the hunk', () => {
    const files = parseDiff(SAMPLE_DIFF);
    const hunk = files[0]!.hunks[0]!;
    expect(resolveLineBySnippet(hunk, 'nonexistent line')).toBeNull();
  });
});
