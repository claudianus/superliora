import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { CoreAPI, RPCMethods } from '@superliora/agent-core';
import { afterEach, describe, expect, it } from 'vitest';

import { SDKRpcClient } from '#/rpc/sdk-rpc-client';
import { Session } from '#/session/session';
import { makeTempDir, removeTempDirs } from './session-runtime-helpers';
import { TEST_IDENTITY } from './test-identity';

class DelayedRpc extends SDKRpcClient {
  delay: Promise<void> | undefined;
  private calls = 0;
  private readonly waiting = new Set<() => void>();

  waitForCalls(count: number): Promise<void> {
    if (this.calls >= count) return Promise.resolve();
    const deferred = Promise.withResolvers<void>();
    const check = () => {
      if (this.calls < count) return;
      this.waiting.delete(check);
      deferred.resolve();
    };
    this.waiting.add(check);
    return deferred.promise;
  }

  protected override async getRpc(): Promise<RPCMethods<CoreAPI>> {
    this.calls += 1;
    for (const check of this.waiting) check();
    if (this.delay !== undefined) await this.delay;
    return super.getRpc();
  }

  resetCalls(): void {
    this.calls = 0;
  }
}

const tempDirs: string[] = [];
afterEach(async () => removeTempDirs(tempDirs));

describe('SDK interactive agent scopes', () => {
  it('isolates overlapping model changes while native RPC resolution is pending', async () => {
    const homeDir = await makeTempDir(tempDirs, 'sdk-agent-scope-');
    const workDir = await makeTempDir(tempDirs, 'sdk-agent-work-');
    await writeFile(join(homeDir, 'config.toml'), `
default_model = "model-a"
[providers.local]
type = "openai"
api_key = "test-key"
base_url = "https://example.test/v1"
[models.model-a]
provider = "local"
model = "a"
max_context_size = 1000
[models.model-b]
provider = "local"
model = "b"
max_context_size = 1000
`);
    const rpc = new DelayedRpc({ homeDir, identity: TEST_IDENTITY });
    try {
      const summary = await rpc.createSession({ id: 'ses_overlapping_agents', workDir });
      const session = new Session({ id: summary.id, workDir, rpc });
      const childId = await session.startBtw();
      rpc.resetCalls();
      const deferred = Promise.withResolvers<void>();
      rpc.delay = deferred.promise;
      const mainChange = rpc.withInteractiveAgent('main', () => session.setModel('model-a'));
      const childChange = rpc.withInteractiveAgent(childId, () => session.setModel('model-b'));
      await rpc.waitForCalls(2);
      deferred.resolve();
      await Promise.all([mainChange, childChange]);
      rpc.delay = undefined;
      expect(rpc.interactiveAgentId).toBe('main');
      await expect(session.getStatus()).resolves.toMatchObject({ model: 'model-a' });
      await expect(rpc.withInteractiveAgent(childId, () => session.getStatus())).resolves.toMatchObject({ model: 'model-b' });
      await expect(session.getStatus()).resolves.toMatchObject({ model: 'model-a' });
    } finally {
      await rpc.close();
    }
  });
});
