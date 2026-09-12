import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Agent } from '../../src/agent';
import { createFileProvenanceHook } from '../../src/agent/tool/builtin-tools';
import { FileProvenanceRecorder } from '../../src/session/file-provenance';

function fakeAgent(recorder: FileProvenanceRecorder | undefined): Agent {
  return {
    fileProvenance: recorder,
    type: 'main',
    config: { modelAlias: 'glm-5.3' },
    turn: { currentId: 3 },
  } as unknown as Agent;
}

describe('createFileProvenanceHook', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'provenance-hook-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('binds agent type/model/turn at record time and never throws', async () => {
    const recorder = new FileProvenanceRecorder({
      filePath: join(dir, 'provenance.ndjson'),
    });
    const hook = createFileProvenanceHook(fakeAgent(recorder));
    expect(hook).toBeDefined();
    await hook?.record({
      path: '/repo/a.ts',
      tool: 'Edit',
      op: 'edit',
      before: 'a\nb\n',
      after: 'a\nB\n',
    });
    const records = await recorder.read();
    expect(records).toEqual([
      expect.objectContaining({
        agentType: 'main',
        model: 'glm-5.3',
        turn: '3',
        op: 'edit',
        added: [{ start: 2, end: 2 }],
      }),
    ]);
  });

  it('returns undefined without a recorder', () => {
    expect(createFileProvenanceHook(fakeAgent(undefined))).toBeUndefined();
  });
});
