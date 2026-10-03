/** Native background task lifecycle events. */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import type { Writable } from 'node:stream';
import { join } from 'pathe';

import type { KaosProcess } from '@superliora/kaos';
import { describe, expect, it, vi } from 'vitest';

import {
  BackgroundTaskPersistence,
  type BackgroundTaskInfo,
} from '../../../src/agent/background';
import {
  agentTask,
  createBackgroundManager,
  registerProcess,
} from './helpers';

function immediateProcess(exitCode: number, stdoutText = ''): KaosProcess {
  return {
    stdin: { write: vi.fn(), end: vi.fn() } as unknown as Writable,
    stdout: Readable.from(stdoutText ? [stdoutText] : []),
    stderr: Readable.from([]),
    pid: 30000 + exitCode,
    exitCode,
    wait: vi.fn().mockResolvedValue(exitCode) as KaosProcess['wait'],
    kill: vi.fn().mockResolvedValue(undefined) as KaosProcess['kill'],
    dispose: vi.fn().mockResolvedValue(undefined) as KaosProcess['dispose'],
  };
}

function pendingProcess(): KaosProcess {
  let resolveWait: (code: number) => void = () => {};
  const waitPromise = new Promise<number>((resolve) => {
    resolveWait = resolve;
  });
  let currentExitCode: number | null = null;
  return {
    stdin: { write: vi.fn(), end: vi.fn() } as unknown as Writable,
    stdout: Readable.from([]),
    stderr: Readable.from([]),
    pid: 99999,
    get exitCode(): number | null {
      return currentExitCode;
    },
    wait: () => waitPromise,
    kill: vi.fn(async () => {
      if (currentExitCode !== null) return;
      currentExitCode = 143;
      resolveWait(143);
    }) as unknown as KaosProcess['kill'],
    dispose: vi.fn().mockResolvedValue(undefined) as KaosProcess['dispose'],
  };
}

function persistedProcess(
  overrides: Partial<Extract<BackgroundTaskInfo, { kind: 'process' }>> = {},
): Extract<BackgroundTaskInfo, { kind: 'process' }> {
  return {
    taskId: 'bash-done0000',
    kind: 'process',
    command: 'echo done',
    description: 'restored shell task',
    pid: 12345,
    startedAt: 1_700_000_000,
    endedAt: 1_700_000_010,
    exitCode: 0,
    status: 'completed',
    ...overrides,
  };
}


describe('BackgroundManager — event emission', () => {

  it('emits background.task.started for process tasks', () => {
    const { agent, manager } = createBackgroundManager();
    const taskId = registerProcess(manager, pendingProcess(), 'sleep 60', 'demo');

    expect(agent.emittedEvents).toContainEqual({
      type: 'background.task.started',
      info: expect.objectContaining({
        taskId,
        kind: 'process',
        status: 'running',
      }),
    });
    expect(agent.telemetry.track).toHaveBeenCalledWith('background_task_created', {
      kind: 'bash',
    });
  });

  it('emits background.task.started for agent tasks', () => {
    const { agent, manager } = createBackgroundManager();
    const taskId = manager.registerTask(
      agentTask(new Promise(() => {}), 'agent task'),
    );

    expect(agent.emittedEvents).toContainEqual({
      type: 'background.task.started',
      info: expect.objectContaining({
        taskId,
        kind: 'agent',
        status: 'running',
      }),
    });
    expect(agent.telemetry.track).toHaveBeenCalledWith('background_task_created', {
      kind: 'agent',
    });
  });

  it('emits background.task.terminated and telemetry on natural exit', async () => {
    const { agent, manager } = createBackgroundManager();
    const taskId = registerProcess(manager, immediateProcess(0), 'echo', 'done');
    agent.telemetry.track.mockClear();

    await manager.wait(taskId);

    expect(agent.emittedEvents).toContainEqual({
      type: 'background.task.terminated',
      info: expect.objectContaining({
        taskId,
        status: 'completed',
      }),
    });
    expect(agent.telemetry.track).toHaveBeenCalledWith(
      'background_task_completed',
      expect.objectContaining({
        kind: 'process',
        duration: expect.any(Number),
        status: 'completed',
      }),
    );
  });

  it('emits a failed event with the actual worker error', async () => {
    const { agent, manager } = createBackgroundManager();
    const taskId = manager.registerTask(
      agentTask(Promise.reject(new Error('provider failed')), 'worker failure'),
    );

    await manager.wait(taskId);

    expect(agent.emittedEvents).toContainEqual({
      type: 'background.task.terminated',
      info: expect.objectContaining({
        taskId,
        kind: 'agent',
        status: 'failed',
        stopReason: 'provider failed',
      }),
    });
    expect(agent.telemetry.track).toHaveBeenCalledWith(
      'background_task_completed',
      expect.objectContaining({ kind: 'agent', status: 'failed' }),
    );
  });

  it('emits background.task.terminated on stop', async () => {
    const { agent, manager } = createBackgroundManager();
    const taskId = registerProcess(manager, pendingProcess(), 'sleep 60', 'long');
    agent.emittedEvents.length = 0;

    await manager.stop(taskId, 'user');

    expect(agent.emittedEvents).toEqual([
      {
        type: 'background.task.terminated',
        info: expect.objectContaining({
          taskId,
          status: 'killed',
        }),
      },
    ]);
  });

  it('emits background.task.terminated when a restored task is marked lost', async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), 'kimi-bg-agent-reconcile-'));
    try {
      const persistence = new BackgroundTaskPersistence(sessionDir);
      await persistence.writeTask(
        persistedProcess({
          taskId: 'bash-orphan00',
          command: 'sleep 60',
          description: 'orphan task',
          endedAt: null,
          exitCode: null,
          status: 'running',
        }),
      );
      const { agent, manager } = createBackgroundManager({ sessionDir });

      await manager.loadFromDisk();
      await manager.reconcile();

      expect(agent.emittedEvents).toContainEqual({
        type: 'background.task.terminated',
        info: expect.objectContaining({
          taskId: 'bash-orphan00',
          status: 'lost',
        }),
      });
    } finally {
      await rm(sessionDir, { recursive: true, force: true });
    }
  });
});

