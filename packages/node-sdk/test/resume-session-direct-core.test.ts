import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SDKRpcClient } from '#/sdk-rpc-client';
import type { ResumedSessionSummary } from '#/types';

import { TEST_IDENTITY } from './test-identity';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeHomeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'kimi-sdk-resume-direct-'));
  tempDirs.push(dir);
  await writeFile(
    join(dir, 'config.toml'),
    `
[providers.local]
type = "kimi"
base_url = "https://example.test/v1"
api_key = "sk-test"

[models.test-model]
provider = "local"
model = "test-model"
max_context_size = 1000
`,
    'utf-8',
  );
  return dir;
}

function stubResumeSummary(id: string): ResumedSessionSummary {
  return {
    id,
    workDir: '/tmp/work',
    sessionDir: '/tmp/session',
    createdAt: 1,
    updatedAt: 1,
    sessionMetadata: {
      createdAt: '',
      updatedAt: '',
      title: '',
      isCustomTitle: false,
      agents: {},
      custom: {},
    },
    agents: {},
  };
}

describe('SDKRpcClient resume/reload bypass RPC serialize', () => {
  it('resumeSession calls core directly (no simulateNetwork stringify)', async () => {
    const homeDir = await makeHomeDir();
    const client = new SDKRpcClient({ homeDir, identity: TEST_IDENTITY });
    const summary = stubResumeSummary('ses_direct_resume');
    const spy = vi
      .spyOn(client.core, 'resumeSessionWithOverrides')
      .mockResolvedValue(summary);

    await expect(client.resumeSession({ id: 'ses_direct_resume' })).resolves.toBe(summary);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'ses_direct_resume', id: 'ses_direct_resume' }),
      {},
    );
  });

  it('reloadSession calls core.reloadSession directly', async () => {
    const homeDir = await makeHomeDir();
    const client = new SDKRpcClient({ homeDir, identity: TEST_IDENTITY });
    const summary = stubResumeSummary('ses_direct_reload');
    const spy = vi.spyOn(client.core, 'reloadSession').mockResolvedValue(summary);

    await expect(
      client.reloadSession({
        sessionId: 'ses_direct_reload',
        forcePluginSessionStartReminder: true,
      }),
    ).resolves.toBe(summary);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith({
      sessionId: 'ses_direct_reload',
      forcePluginSessionStartReminder: true,
    });
  });
});
