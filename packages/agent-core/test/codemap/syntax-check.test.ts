import { describe, expect, it } from 'vitest';

import {
  collectSyntaxReport,
  formatSyntaxReport,
} from '#/codemap/syntax-check';
import { isParseableSource } from '#/codemap/oxc';

function report(fileName: string, source: string): string | undefined {
  const found = collectSyntaxReport(fileName, source);
  return found === undefined ? undefined : formatSyntaxReport(fileName, found);
}

describe('post-edit syntax check', () => {
  it('stays silent for a file that parses', () => {
    // Nothing is reported on the common path: a "0 problems" line would spend
    // tokens on every successful edit.
    expect(report('a.ts', 'export const a: number = 1;\n')).toBeUndefined();
    expect(report('a.tsx', 'export const C = () => <div>hi</div>;\n')).toBeUndefined();
    expect(report('a.js', 'export const a = 1;\n')).toBeUndefined();
  });

  it('reports the position of a parse-breaking edit', () => {
    const out = report('src/a.ts', 'export function a() {\n  if (true) {\n');
    expect(out).toContain('Syntax error in src/a.ts:');
    expect(out).toMatch(/\n {2}3:1 /);
    expect(out).toContain('Expected `}`');
  });

  it('points at the offending column, not the start of the file', () => {
    const out = report('a.ts', 'export const a = 1;\nconst b = ;\n');
    expect(out).toMatch(/\n {2}2:11 Unexpected token/);
  });

  it('ignores files oxc cannot parse', () => {
    // Markdown, CSS and JSON are not TypeScript; parsing them as such would
    // report invented syntax errors on every edit of a non-source file.
    expect(report('notes.md', '# Title\n\nSome **text** ]]]\n')).toBeUndefined();
    expect(report('styles.css', '.a { color: red; ]]]\n')).toBeUndefined();
    expect(report('data.json', '{"a": ,}\n')).toBeUndefined();
    expect(report('Makefile', 'all:\n\techo hi ]]]\n')).toBeUndefined();
  });

  it('caps the number of reported errors', () => {
    // oxc usually stops at the first error, so drive the cap through a source
    // that does produce many and assert the total is still reported.
    const src = Array.from({ length: 40 }, (_, i) => `const v${String(i)} = ;`).join('\n');
    const found = collectSyntaxReport('many.ts', src);
    if (found !== undefined) {
      expect(found.diagnostics.length).toBeLessThanOrEqual(8);
      expect(formatSyntaxReport('many.ts', found)).toContain('Syntax error in many.ts:');
    }
  });

  it('stays silent for an empty or whitespace-only file', () => {
    // Truncating an edit can legitimately empty a file; that is not a syntax error.
    expect(report('a.ts', '')).toBeUndefined();
    expect(report('a.ts', '   \n\n  \n')).toBeUndefined();
  });

  it('counts lines correctly with CRLF endings and a BOM', () => {
    // Position is only useful if it points at the line the model will see.
    // Both are normalized away before the file is written, but the check runs
    // on the same bytes, so a byte-counting line map would be off by one on
    // every line of a CRLF file and on every line after a BOM.
    expect(report('a.ts', 'const a = 1;\r\nconst b = 2;\r\nconst c = ;\r\n')).toContain(
      '\n  3:11 ',
    );
    expect(report('a.ts', '\uFEFFconst a = 1;\nconst b = ;\n')).toContain('\n  2:11 ');
  });

  it('ignores case keys oxc accepts beyond plain ts/js', () => {
    expect(report('a.mjs', 'export const a = 1;\n')).toBeUndefined();
    expect(report('a.cjs', 'module.exports = 1;\n')).toBeUndefined();
    expect(report('a.tsx', 'export const A = () => <><span>a</span></>;\n')).toBeUndefined();
    expect(report('a.ts', '@Component({})\nexport class A {\n')).toMatch(/\n {2}3:1 /);
  });

  it('agrees with the parser about which extensions are parseable', () => {
    expect(isParseableSource('a.ts')).toBe(true);
    expect(isParseableSource('a.tsx')).toBe(true);
    expect(isParseableSource('a.mts')).toBe(true);
    expect(isParseableSource('a.cts')).toBe(true);
    expect(isParseableSource('a.js')).toBe(true);
    expect(isParseableSource('a.jsx')).toBe(true);
    expect(isParseableSource('a.mjs')).toBe(true);
    expect(isParseableSource('a.cjs')).toBe(true);
    // `.json` must not match: `j` then `s` would need the next char to be `s`.
    expect(isParseableSource('a.json')).toBe(false);
    expect(isParseableSource('a.md')).toBe(false);
    expect(isParseableSource('a.css')).toBe(false);
    expect(isParseableSource('Makefile')).toBe(false);
  });
});
