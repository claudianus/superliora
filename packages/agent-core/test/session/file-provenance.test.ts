import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  FILE_PROVENANCE_ENV,
  FileProvenanceRecorder,
  readProvenanceFile,
  type FileProvenanceRecord,
} from '../../src/session/file-provenance';

describe('FileProvenanceRecorder', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'provenance-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function sink(): string {
    return join(dir, 'provenance.ndjson');
  }

  function parsedRecords(): readonly FileProvenanceRecord[] {
    const lines = readFileSync(sink(), 'utf8').split('\n').filter((l) => l.length > 0);
    return lines.slice(1).map((line) => JSON.parse(line) as FileProvenanceRecord);
  }

  it('writes a meta header once, then one record per mutation', async () => {
    const recorder = new FileProvenanceRecorder({ filePath: sink(), cwd: '/repo' });
    await recorder.record(
      { path: '/repo/a.ts', tool: 'Write', op: 'create', before: null, after: 'one\ntwo\n' },
      { agentType: 'main', model: 'glm-5.3', turn: '7' },
    );
    await recorder.record(
      { path: '/repo/a.ts', tool: 'Edit', op: 'edit', before: 'one\ntwo\n', after: 'one\nTWO\n' },
      { agentType: 'main', model: 'glm-5.3', turn: '7' },
    );

    const raw = readFileSync(sink(), 'utf8').split('\n').filter((l) => l.length > 0);
    expect(JSON.parse(raw[0] ?? '{}')).toMatchObject({ kind: 'superliora-file-provenance', v: 1, cwd: '/repo' });
    expect(raw).toHaveLength(3);

    const [created, edited] = parsedRecords();
    expect(created).toMatchObject({
      v: 1,
      tool: 'Write',
      op: 'create',
      path: '/repo/a.ts',
      added: [{ start: 1, end: 2 }],
      addedLines: 2,
      removedLines: 0,
      agentType: 'main',
      model: 'glm-5.3',
      turn: '7',
    });
    expect(created?.contentHash).toBeDefined();
    expect(edited).toMatchObject({ op: 'edit', added: [{ start: 2, end: 2 }], removedLines: 1 });
  });

  it('omits optional context fields when absent', async () => {
    const recorder = new FileProvenanceRecorder({ filePath: sink() });
    await recorder.record(
      { path: '/repo/a.ts', tool: 'Write', op: 'create', before: null, after: 'x\n' },
      { agentType: 'sub' },
    );
    const record = parsedRecords()[0];
    expect(record).toMatchObject({ agentType: 'sub' });
    expect(record?.model).toBeUndefined();
    expect(record?.turn).toBeUndefined();
  });

  it('skips no-op mutations but always records deletes', async () => {
    const recorder = new FileProvenanceRecorder({ filePath: sink() });
    await recorder.record(
      { path: '/repo/a.ts', tool: 'Write', op: 'overwrite', before: 'same\n', after: 'same\n' },
      { agentType: 'main' },
    );
    await recorder.record(
      { path: '/repo/a.ts', tool: 'ApplyPatch', op: 'delete', before: null, after: null },
      { agentType: 'main' },
    );
    const records = parsedRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ op: 'delete', path: '/repo/a.ts' });
  });

  it('skips sensitive paths entirely', async () => {
    const recorder = new FileProvenanceRecorder({ filePath: sink() });
    await recorder.record(
      { path: '/repo/.env', tool: 'Write', op: 'create', before: null, after: 'SECRET=1\n' },
      { agentType: 'main' },
    );
    await recorder.record(
      { path: '/repo/.ssh/id_rsa', tool: 'Write', op: 'overwrite', before: 'k\n', after: 'k2\n' },
      { agentType: 'main' },
    );
    await expect(readProvenanceFile(sink())).resolves.toEqual([]);
  });

  it('honors hashSource over after when hashing', async () => {
    const recorder = new FileProvenanceRecorder({ filePath: sink() });
    await recorder.record(
      {
        path: '/repo/a.ts',
        tool: 'Edit',
        op: 'edit',
        before: 'a\nb\n',
        after: 'a\nB\n',
        hashSource: 'a\r\nB\r\n',
      },
      { agentType: 'main' },
    );
    const { createHash } = (await import('node:crypto')) as typeof import('node:crypto');
    const expected = createHash('sha256').update('a\r\nB\r\n', 'utf8').digest('hex');
    expect(parsedRecords()[0]?.contentHash).toBe(expected);
  });

  it('is disabled without a sink and via the kill-switch env', async () => {
    const noSink = new FileProvenanceRecorder({});
    expect(noSink.enabled).toBe(false);
    await noSink.record(
      { path: '/repo/a.ts', tool: 'Write', op: 'create', before: null, after: 'x\n' },
      { agentType: 'main' },
    );
    expect(await noSink.read()).toEqual([]);

    const previous = process.env[FILE_PROVENANCE_ENV];
    process.env[FILE_PROVENANCE_ENV] = '0';
    try {
      const switchedOff = new FileProvenanceRecorder({ filePath: sink() });
      expect(switchedOff.enabled).toBe(false);
    } finally {
      if (previous === undefined) delete process.env[FILE_PROVENANCE_ENV];
      else process.env[FILE_PROVENANCE_ENV] = previous;
    }
  });

  it('tolerates corrupt lines when reading', async () => {
    const recorder = new FileProvenanceRecorder({ filePath: sink(), cwd: '/repo' });
    await recorder.record(
      { path: '/repo/a.ts', tool: 'Write', op: 'create', before: null, after: 'x\n' },
      { agentType: 'main' },
    );
    const { appendFileSync } = await import('node:fs');
    appendFileSync(sink(), '{torn json\n');
    const records = await recorder.read();
    expect(records).toHaveLength(1);
    expect(records[0]?.path).toBe('/repo/a.ts');
  });
});
