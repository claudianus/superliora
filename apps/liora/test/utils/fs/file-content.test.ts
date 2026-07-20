import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadFileForViewer } from '#/utils/fs/file-content';

describe('loadFileForViewer', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'liora-file-content-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads a text file with content, bytes, and line count', () => {
    const file = join(dir, 'sample.ts');
    const text = 'const a = 1;\nconst b = 2;\nconst c = 3;';
    writeFileSync(file, text);

    const result = loadFileForViewer(file);

    expect(result).toMatchObject({
      kind: 'text',
      content: text,
      bytes: Buffer.byteLength(text),
      lineCount: 3,
    });
  });

  it('normalizes CRLF and lone CR to LF', () => {
    const file = join(dir, 'mixed.txt');
    writeFileSync(file, 'one\r\ntwo\rthree\nfour');

    const result = loadFileForViewer(file);

    expect(result.kind).toBe('text');
    if (result.kind !== 'text') return;
    expect(result.content).toBe('one\ntwo\nthree\nfour');
    expect(result.lineCount).toBe(4);
  });

  it('treats a file with a NUL byte in the first 8 KiB as binary', () => {
    const file = join(dir, 'blob.bin');
    writeFileSync(file, Buffer.from([0x68, 0x69, 0x00, 0x62, 0x79, 0x65]));

    expect(loadFileForViewer(file)).toEqual({ kind: 'binary' });
  });

  it('reports oversize files without reading them', () => {
    const file = join(dir, 'big.txt');
    writeFileSync(file, 'x'.repeat(100));

    expect(loadFileForViewer(file, { maxBytes: 50 })).toEqual({
      kind: 'too-large',
      bytes: 100,
    });
  });

  it('returns an error result for a missing path', () => {
    expect(loadFileForViewer(join(dir, 'nope.txt'))).toMatchObject({
      kind: 'error',
      message: 'no such file or directory',
    });
  });

  it('returns an error result for a directory', () => {
    const sub = join(dir, 'sub');
    mkdirSync(sub);

    expect(loadFileForViewer(sub)).toMatchObject({
      kind: 'error',
      message: 'is a directory',
    });
  });
});
