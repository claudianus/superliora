import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createLioraHarness } from '#/index';

import { TEST_IDENTITY } from './test-identity';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('LioraHarness memory', () => {
  it('exposes durable Liora Recall through harness and session helpers', async () => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    const harness = createLioraHarness({ identity: TEST_IDENTITY, homeDir });

    try {
      const global = await harness.memory.remember({
        kind: 'procedural',
        scope: 'user',
        subject: 'search preference',
        content: 'The user prefers rg for repository search.',
        tags: ['preference'],
        importance: 0.9,
      });
      const globalResults = await harness.memory.search({ query: 'repository search rg', limit: 3 });

      expect(globalResults[0]?.memory.id).toBe(global.id);

      const session = await harness.createSession({ id: 'ses_memory', workDir });
      const projectMemory = await session.remember({
        kind: 'semantic',
        scope: 'workspace',
        subject: 'project codename',
        content: 'This workspace is testing Liora Recall.',
        tags: ['manual'],
      });
      const sessionResults = await session.recall('testing recall workspace', { limit: 5 });

      expect(sessionResults.some((result) => result.memory.id === projectMemory.id)).toBe(true);
    } finally {
      await harness.close();
    }
  });
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'kimi-sdk-memory-'));
  tempDirs.push(dir);
  return dir;
}
