import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseDroppedFilePaths } from '#/tui/utils/media-drop';

let dir: string;
let pngFile: string;
let textFile: string;
let spacedFile: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'media-drop-'));
  pngFile = join(dir, 'a.png');
  textFile = join(dir, 'b.txt');
  spacedFile = join(dir, 'my image.png');
  writeFileSync(pngFile, 'x');
  writeFileSync(textFile, 'y');
  writeFileSync(spacedFile, 'z');
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('parseDroppedFilePaths', () => {
  it('returns null for plain prose', () => {
    expect(parseDroppedFilePaths('hello world')).toBeNull();
    expect(parseDroppedFilePaths(`look at ${pngFile} please`)).toBeNull();
  });

  it('returns null for empty or whitespace input', () => {
    expect(parseDroppedFilePaths('')).toBeNull();
    expect(parseDroppedFilePaths('   \n  ')).toBeNull();
  });

  it('returns null for relative paths (too ambiguous to be drops)', () => {
    expect(parseDroppedFilePaths('src/index.ts')).toBeNull();
  });

  it('returns null when a listed path does not exist', () => {
    expect(parseDroppedFilePaths(join(dir, 'missing.png'))).toBeNull();
  });

  it('parses a single existing absolute path', () => {
    expect(parseDroppedFilePaths(pngFile)).toEqual([pngFile]);
    // Terminals often append a trailing newline on drop.
    expect(parseDroppedFilePaths(`${pngFile}\n`)).toEqual([pngFile]);
  });

  it('parses backslash-escaped spaces (iTerm2 style)', () => {
    const escaped = spacedFile.replaceAll(' ', '\\ ');
    expect(parseDroppedFilePaths(escaped)).toEqual([spacedFile]);
  });

  it('parses quoted paths', () => {
    expect(parseDroppedFilePaths(`"${spacedFile}"`)).toEqual([spacedFile]);
    expect(parseDroppedFilePaths(`'${spacedFile}'`)).toEqual([spacedFile]);
  });

  it('parses file:// URLs with percent-encoding', () => {
    const url = pathToFileURL(spacedFile).toString();
    expect(url).toContain('%20');
    expect(parseDroppedFilePaths(url)).toEqual([spacedFile]);
  });

  it('parses multi-line drops where every line is an existing file', () => {
    expect(parseDroppedFilePaths(`${pngFile}\n${textFile}\n`)).toEqual([pngFile, textFile]);
  });

  it('rejects multi-line drops when any line is not an existing file', () => {
    expect(parseDroppedFilePaths(`${pngFile}\nnot a path`)).toBeNull();
    expect(parseDroppedFilePaths(`${pngFile}\n${join(dir, 'missing.png')}`)).toBeNull();
  });

  it('parses space-separated file:// URLs on one line', () => {
    const urls = `${pathToFileURL(pngFile).toString()} ${pathToFileURL(textFile).toString()}`;
    expect(parseDroppedFilePaths(urls)).toEqual([pngFile, textFile]);
  });
});
