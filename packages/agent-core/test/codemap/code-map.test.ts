import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CodeMap, getCodeMapForWorkspace } from '#/codemap/code-map';

describe('getCodeMapForWorkspace', () => {
  it('caches one CodeMap per workspace dir', () => {
    const first = getCodeMapForWorkspace('/codemap-singleton/alpha');
    expect(getCodeMapForWorkspace('/codemap-singleton/alpha')).toBe(first);
    expect(getCodeMapForWorkspace('/codemap-singleton/beta')).not.toBe(first);
  });
});

describe('CodeMap', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'code-map-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('degrades gracefully when the workspace is not a git repository', () => {
    const codemap = new CodeMap(dir, ':memory:');
    expect(codemap.ensureReady()).toBe(false);
    // Repeated calls stay false without throwing (unusable is sticky).
    expect(codemap.ensureReady()).toBe(false);
    expect(codemap.findSymbol('alpha', 10)).toEqual([]);
    codemap.close();
  });

  it('finds symbols across indexed files in a git workspace', () => {
    writeFileSync(join(dir, 'a.ts'), 'export function alpha() {}\nfunction hidden() {}\n');
    writeFileSync(join(dir, 'b.ts'), 'export const beta = 1;\n');
    spawnSync('git', ['init', '-q'], { cwd: dir });
    spawnSync('git', ['add', 'a.ts', 'b.ts'], { cwd: dir });

    const codemap = new CodeMap(dir, ':memory:');
    expect(codemap.ensureReady()).toBe(true);

    const alpha = codemap.findSymbol('alpha', 10);
    expect(alpha).toHaveLength(1);
    expect(alpha[0]).toMatchObject({
      startLine: 1,
      kind: 'function',
      signature: 'function alpha',
      exported: true,
    });
    expect(alpha[0]?.filePath.endsWith('a.ts')).toBe(true);

    expect(codemap.findSymbol('beta', 10)[0]).toMatchObject({
      kind: 'variable',
      signature: 'variable beta',
      exported: true,
    });
    expect(codemap.findSymbol('missing', 10)).toEqual([]);
    codemap.close();
  });

  it('respects maxResults', () => {
    writeFileSync(join(dir, 'many.ts'), 'export const dup = 1;\nexport function dup() {}\n');
    spawnSync('git', ['init', '-q'], { cwd: dir });
    spawnSync('git', ['add', 'many.ts'], { cwd: dir });

    const codemap = new CodeMap(dir, ':memory:');
    expect(codemap.ensureReady()).toBe(true);
    expect(codemap.findSymbol('dup', 1)).toHaveLength(1);
    expect(codemap.findSymbol('dup', 5).length).toBeGreaterThanOrEqual(2);
    codemap.close();
  });

  it('outlines a single file live without any index', () => {
    const file = join(dir, 'outline.ts');
    writeFileSync(file, 'export class Widget {}\nconst internal = 2;\n');

    const codemap = new CodeMap(dir, ':memory:');
    const outline = codemap.outlineFile(file);
    expect(outline.map((hit) => hit.signature)).toEqual(['class Widget', 'variable internal']);
    expect(outline[0]).toMatchObject({ filePath: file, startLine: 1, exported: true });
    expect(outline[1]).toMatchObject({ startLine: 2, exported: false });
    codemap.close();
  });

  it('returns an empty outline for a missing file', () => {
    const codemap = new CodeMap(dir, ':memory:');
    expect(codemap.outlineFile(join(dir, 'nope.ts'))).toEqual([]);
    codemap.close();
  });
});
