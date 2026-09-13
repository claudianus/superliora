import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { loadProvenanceAnnotations } from '#/utils/git/git-provenance';

function sha256(content: string): string {
  // Mirrors agent-core's record hashing without importing agent-core (the
  // app depends on the SDK only).
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

const WORK_DIR = '/repo';
const FILE = 'src/a.ts';
const FILE_ABS = '/repo/src/a.ts';
const FILE_CONTENT = 'one\ntwo\nthree\n';
const FILE_HASH = sha256(FILE_CONTENT);

function metaLine(): string {
  return JSON.stringify({ kind: 'superliora-file-provenance', v: 1, cwd: WORK_DIR });
}

function record(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    v: 1,
    ts: 1_000,
    agentType: 'main',
    model: 'glm-5.3',
    tool: 'Edit',
    op: 'edit',
    path: FILE_ABS,
    added: [{ start: 2, end: 2 }],
    addedLines: 1,
    removedLines: 0,
    contentHash: FILE_HASH,
    ...overrides,
  });
}

function fakeFs(files: Record<string, string>) {
  return async (path: string): Promise<string> => {
    const content = files[path];
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  };
}

describe('loadProvenanceAnnotations', () => {
  it('annotates recorded line ranges when the file hash matches', async () => {
    const annotations = await loadProvenanceAnnotations({
      sessionDir: '/session',
      target: FILE,
      workDir: WORK_DIR,
      readTextFile: fakeFs({
        [FILE_ABS]: FILE_CONTENT,
        '/session/provenance.ndjson': [metaLine(), record({})].join('\n'),
      }),
    });
    expect(annotations.get(2)).toEqual({ model: 'glm-5.3', agentType: 'main', ts: 1_000 });
    expect(annotations.has(1)).toBe(false);
    expect(annotations.has(3)).toBe(false);
  });

  it('resolves the target against workDir and absolute targets alike', async () => {
    const fs = fakeFs({
      [FILE_ABS]: FILE_CONTENT,
      '/session/provenance.ndjson': record({}),
    });
    const relative = await loadProvenanceAnnotations({
      sessionDir: '/session',
      target: FILE,
      workDir: WORK_DIR,
      readTextFile: fs,
    });
    const absolute = await loadProvenanceAnnotations({
      sessionDir: '/session',
      target: FILE_ABS,
      workDir: WORK_DIR,
      readTextFile: fs,
    });
    expect(relative.size).toBe(1);
    expect(absolute.size).toBe(1);
  });

  it('returns empty when the file drifted after the recorded edit', async () => {
    const annotations = await loadProvenanceAnnotations({
      sessionDir: '/session',
      target: FILE,
      workDir: WORK_DIR,
      readTextFile: fakeFs({
        [FILE_ABS]: 'one\ntwo edited\nthree\n',
        '/session/provenance.ndjson': record({}),
      }),
    });
    expect(annotations.size).toBe(0);
  });

  it('returns empty when the log or the file is missing', async () => {
    const emptyFile = await loadProvenanceAnnotations({
      sessionDir: '/session',
      target: FILE,
      workDir: WORK_DIR,
      readTextFile: fakeFs({}),
    });
    expect(emptyFile.size).toBe(0);

    const missingLog = await loadProvenanceAnnotations({
      sessionDir: '/session',
      target: 'src/missing.ts',
      workDir: WORK_DIR,
      readTextFile: fakeFs({
        'src/missing.ts': FILE_CONTENT,
      }),
    });
    expect(missingLog.size).toBe(0);
  });

  it('skips corrupt and meta lines, and lets newer records win per line', async () => {
    const log = [
      metaLine(),
      '{torn',
      record({ ts: 1_000, added: [{ start: 1, end: 3 }] }),
      record({ ts: 2_000, added: [{ start: 3, end: 3 }], model: 'other-model' }),
    ].join('\n');
    const annotations = await loadProvenanceAnnotations({
      sessionDir: '/session',
      target: FILE,
      workDir: WORK_DIR,
      readTextFile: fakeFs({ [FILE_ABS]: FILE_CONTENT, '/session/provenance.ndjson': log }),
    });
    expect(annotations.get(1)?.model).toBe('glm-5.3');
    expect(annotations.get(2)?.model).toBe('glm-5.3');
    expect(annotations.get(3)?.model).toBe('other-model');
  });

  it('matches records whose path only differs by separators', async () => {
    const annotations = await loadProvenanceAnnotations({
      sessionDir: '/session',
      target: FILE,
      workDir: WORK_DIR,
      readTextFile: fakeFs({
        [FILE_ABS]: FILE_CONTENT,
        '/session/provenance.ndjson': record({ path: '\\repo\\src\\a.ts' }),
      }),
    });
    expect(annotations.size).toBe(1);
  });
});
