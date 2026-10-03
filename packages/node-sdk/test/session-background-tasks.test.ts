import { setTimeout as delay } from 'node:timers/promises';
import type * as KosongModule from '@superliora/kosong';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLioraHarness, type LioraError } from '#/index';

import { makeTempDir, removeTempDirs, waitForSDKEvent } from './session-runtime-helpers';
import { TEST_IDENTITY } from './test-identity';

const providerState = vi.hoisted(() => ({ calls: 0 }));
beforeEach(() => { providerState.calls = 0; });

vi.mock('@superliora/kosong', async (importOriginal) => {
  const actual = await importOriginal<typeof KosongModule>();
  return {
    ...actual,
    createProvider: () => ({
      name: 'background-provider',
      modelName: 'background-model',
      thinkingEffort: null,
      async generate() {
        const startProcess = providerState.calls++ === 0;
        return {
          id: 'background-response',
          usage: { inputOther: 1, output: 1, inputCacheRead: 0, inputCacheCreation: 0 },
          finishReason: startProcess ? 'tool_calls' : 'completed',
          rawFinishReason: startProcess ? 'tool_calls' : 'stop',
          async *[Symbol.asyncIterator]() {
            if (startProcess) {
              yield {
                type: 'function',
                id: 'start-background-process',
                name: 'Bash',
                arguments: JSON.stringify({
                  command: "printf 'sdk-background-ready\\n'; sleep 60",
                  description: 'SDK owned process',
                  run_in_background: true,
                  timeout: 120,
                }),
              };
            } else {
              yield { type: 'text', text: 'The process is running.' };
            }
          },
        };
      },
      withThinking() { return this; },
    }),
  };
});

const tempDirs: string[] = [];

afterEach(async () => {
  await removeTempDirs(tempDirs);
});

describe('Session.listBackgroundTasks / getBackgroundTaskOutput', () => {
  it('reports actual Bash process output and joins a requested stop before marking it terminal', async () => {
    const homeDir = await makeTempDir(tempDirs, 'sdk-background-home-');
    const workDir = await makeTempDir(tempDirs, 'sdk-background-work-');
    const harness = createLioraHarness({ homeDir, identity: TEST_IDENTITY });
    try {
      await harness.setConfig({
        providers: { local: { type: 'openai', apiKey: 'test-key', baseUrl: 'https://example.test/v1' } },
        models: { 'background-model': { provider: 'local', model: 'background-model', maxContextSize: 1000 } },
        defaultModel: 'background-model',
      });
      const session = await harness.createSession({ id: 'ses_background_process', workDir, permission: 'yolo' });
      const started = waitForSDKEvent(session, (event) => event.type === 'background.task.started', 10_000);
      const ended = waitForSDKEvent(session, (event) => event.type === 'turn.ended', 10_000);
      await session.prompt('Start the requested background process.');
      const event = await started;
      await ended;
      if (event.type !== 'background.task.started') throw new Error('Expected a background task start');
      const taskId = event.info.taskId;
      expect(event.info).toMatchObject({ kind: 'process', status: 'running', endedAt: null });
      await expect(session.listBackgroundTasks({ activeOnly: true })).resolves.toEqual(
        expect.arrayContaining([expect.objectContaining({ taskId, status: 'running' })]),
      );
      let output = '';
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        output = await session.getBackgroundTaskOutput(taskId);
        if (output.includes('sdk-background-ready')) break;
        await delay(10);
      }
      expect(output).toContain('sdk-background-ready');
      const terminated = waitForSDKEvent(session, (next) =>
        next.type === 'background.task.terminated' && next.info.taskId === taskId, 10_000);
      await session.stopBackgroundTask(taskId, { reason: 'operator stop' });
      await expect(terminated).resolves.toMatchObject({ info: { taskId, status: 'killed', endedAt: expect.any(Number) } });
      await expect(session.listBackgroundTasks({ activeOnly: true })).resolves.toEqual([]);
      expect(await session.getBackgroundTaskOutput(taskId)).toContain('sdk-background-ready');
    } finally {
      await harness.close();
    }
  });

  it('returns empty output for an unknown task id', async () => {
    const homeDir = await makeTempDir(tempDirs, 'kimi-sdk-bgtask-home-');
    const workDir = await makeTempDir(tempDirs, 'kimi-sdk-bgtask-work-');
    const harness = createLioraHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      const session = await harness.createSession({ id: 'ses_bg_unknown', workDir });
      // Unknown task ids must not throw — UI fetches output speculatively.
      await expect(session.getBackgroundTaskOutput('bash-deadbeef')).resolves.toBe('');
    } finally {
      await harness.close();
    }
  });

  it('rejects empty task ids with a stable error code', async () => {
    const homeDir = await makeTempDir(tempDirs, 'kimi-sdk-bgtask-home-');
    const workDir = await makeTempDir(tempDirs, 'kimi-sdk-bgtask-work-');
    const harness = createLioraHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      const session = await harness.createSession({ id: 'ses_bg_empty_id', workDir });
      await expect(session.getBackgroundTaskOutput('')).rejects.toMatchObject({
        name: 'LioraError',
        code: 'background.task_id_empty',
      } satisfies Partial<LioraError>);
      await expect(session.stopBackgroundTask('')).rejects.toMatchObject({
        name: 'LioraError',
        code: 'background.task_id_empty',
      } satisfies Partial<LioraError>);
    } finally {
      await harness.close();
    }
  });

  it('rejects after the session is closed', async () => {
    const homeDir = await makeTempDir(tempDirs, 'kimi-sdk-bgtask-home-');
    const workDir = await makeTempDir(tempDirs, 'kimi-sdk-bgtask-work-');
    const harness = createLioraHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      const session = await harness.createSession({ id: 'ses_bg_closed', workDir });
      await session.close();

      await expect(session.listBackgroundTasks()).rejects.toMatchObject({
        name: 'LioraError',
        code: 'session.closed',
      } satisfies Partial<LioraError>);
      await expect(session.getBackgroundTaskOutput('bash-aaaaaaaa')).rejects.toMatchObject({
        name: 'LioraError',
        code: 'session.closed',
      } satisfies Partial<LioraError>);
      await expect(session.stopBackgroundTask('bash-aaaaaaaa')).rejects.toMatchObject({
        name: 'LioraError',
        code: 'session.closed',
      } satisfies Partial<LioraError>);
    } finally {
      await harness.close();
    }
  });

  it('stopBackgroundTask is a no-op for an unknown task id', async () => {
    const homeDir = await makeTempDir(tempDirs, 'kimi-sdk-bgtask-home-');
    const workDir = await makeTempDir(tempDirs, 'kimi-sdk-bgtask-work-');
    const harness = createLioraHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      const session = await harness.createSession({ id: 'ses_bg_stop_unknown', workDir });
      // Unknown task ids must not throw — the core BPM silently no-ops.
      await expect(
        session.stopBackgroundTask('bash-deadbeef', { reason: 'test' }),
      ).resolves.toBeUndefined();
    } finally {
      await harness.close();
    }
  });
});
