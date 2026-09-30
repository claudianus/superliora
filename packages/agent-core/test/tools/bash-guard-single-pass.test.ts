/**
 * One Bash call used to run the worker-command guard twice with identical
 * inputs: once inside request validation and once in execution (plus the brief
 * read the guard performs). The guard is a dozen whole-command regex scans and
 * per-token path resolution, so it is now computed once and shared.
 */
import { describe, expect, it, vi } from 'vitest';

import type { Environment } from '@superliora/kaos';

import { guardWorkerShellCommand } from '../../src/tools/builtin/job/job-worker-guards';
import { BashTool } from '../../src/tools/builtin/shell/bash';
import { createBackgroundManager } from '../agent/background/helpers';
import { createFakeKaos } from './fixtures/fake-kaos';
import { executeTool } from './fixtures/execute-tool';

vi.mock('../../src/tools/builtin/job/job-worker-guards', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/tools/builtin/job/job-worker-guards')>();
  return { ...actual, guardWorkerShellCommand: vi.fn(actual.guardWorkerShellCommand) };
});

const posixEnv: Environment = {
  osKind: 'Linux',
  osArch: 'x86_64',
  osVersion: 'test',
  shellPath: '/bin/bash',
  shellName: 'bash',
};

describe('BashTool worker guard passes', () => {
  it('runs the worker-command guard once per call', async () => {
    const guard = vi.mocked(guardWorkerShellCommand);
    guard.mockClear();

    const execWithEnv = vi.fn().mockResolvedValue({
      stdin: { end: vi.fn(), write: vi.fn() },
      stdout: { [Symbol.asyncIterator]: async function* () {} },
      stderr: { [Symbol.asyncIterator]: async function* () {} },
      pid: 1,
      exitCode: 0,
      wait: vi.fn(async () => 0),
      kill: vi.fn(async () => {}),
      dispose: vi.fn(async () => {}),
    });
    const tool = new BashTool(
      createFakeKaos({ execWithEnv, osEnv: posixEnv }),
      '/workspace',
      createBackgroundManager().manager,
    );

    await executeTool(tool, {
      turnId: '0',
      toolCallId: 'tc_guard_once',
      args: { command: 'echo hi', timeout: 1000 },
      signal: new AbortController().signal,
    });

    expect(guard).toHaveBeenCalledTimes(1);
  });
});