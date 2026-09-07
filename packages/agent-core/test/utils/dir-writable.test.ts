import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isDirWritable } from '../../src/utils/dir-writable';

function scratchDir(): string {
  return mkdtempSync(join(tmpdir(), 'dir-writable-'));
}

describe('isDirWritable', () => {
  it('reports a real writable directory as writable', () => {
    const dir = scratchDir();
    try {
      expect(isDirWritable(dir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports a missing directory as unwritable', () => {
    const missing = join(scratchDir(), 'nope');
    expect(isDirWritable(missing)).toBe(false);
  });

  it('reports a regular file (not a directory) as unwritable', () => {
    const dir = scratchDir();
    const file = join(dir, 'regular-file');
    writeFileSync(file, 'x');
    try {
      expect(isDirWritable(file)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
