import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createLioraHarness, type LioraError } from '#/index';

import { makeTempDir, removeTempDirs } from './session-runtime-helpers';
import { TEST_IDENTITY } from './test-identity';

// node-sdk/agent-core normalize paths to forward slashes (pathe). Mirror that
// in path assertions so they hold on Windows, where node:path produces
// backslashes.
const toPosix = (p: string): string => p.replaceAll('\\', '/');

const tempDirs: string[] = [];

afterEach(async () => {
  await removeTempDirs(tempDirs);
});

describe('Session compaction and resume APIs', () => {
  it('rejects manual compaction on an empty session with compaction.unable', async () => {
    const homeDir = await makeTempDir(tempDirs, 'kimi-sdk-compact-home-');
    const workDir = await makeTempDir(tempDirs, 'kimi-sdk-compact-work-');
    await writeTestConfig(homeDir);
    const harness = createLioraHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      const session = await harness.createSession({ id: 'ses_compact_runtime', workDir });

      await expect(session.compact({ instruction: 'Keep important facts.' })).rejects.toMatchObject({
        name: 'LioraError',
        code: 'compaction.unable',
      } satisfies Partial<LioraError>);
    } finally {
      await harness.close();
    }
  });

  it('resumes a persisted session and restores native runtime configuration', async () => {
    const homeDir = await makeTempDir(tempDirs, 'kimi-sdk-resume-home-');
    const workDir = await makeTempDir(tempDirs, 'kimi-sdk-resume-work-');
    await writeTestConfig(homeDir);
    const harness = createLioraHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      const created = await harness.createSession({
        id: 'ses_resume_runtime',
        workDir,
        model: 'test-model',
      });
      await created.setThinking('low');
      await created.setPermission('manual');
      await created.close();
      expect(harness.getSession(created.id)).toBeUndefined();

      const resumed = await harness.resumeSession({ id: created.id });

      expect(resumed.id).toBe(created.id);
      expect(resumed.workDir).toBe(toPosix(workDir));
      await expect(resumed.getStatus()).resolves.toMatchObject({
        model: 'test-model',
        thinkingLevel: 'low',
        permission: 'manual',
      });
      expect(harness.getSession(created.id)).toBe(resumed);
    } finally {
      await harness.close();
    }
  });

  it('rejects an empty resume id', async () => {
    const homeDir = await makeTempDir(tempDirs, 'kimi-sdk-resume-empty-home-');
    const harness = createLioraHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      await expect(harness.resumeSession({ id: '   ' })).rejects.toMatchObject({
        name: 'LioraError',
        code: 'session.id_empty',
      } satisfies Partial<LioraError>);
    } finally {
      await harness.close();
    }
  });
});

async function writeTestConfig(homeDir: string): Promise<void> {
  await writeFile(
    join(homeDir, 'config.toml'),
    `
default_model = "test-model"

[providers.local]
type = "openai"
base_url = "https://example.test/v1"
api_key = "sk-test"

[models.test-model]
provider = "local"
model = "test-model"
max_context_size = 200000
`,
    'utf-8',
  );
}

