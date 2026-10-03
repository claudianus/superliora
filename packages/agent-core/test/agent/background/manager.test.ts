/**
 * Covers: BackgroundManager.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { PassThrough, Readable } from 'node:stream';
import type { Writable } from 'node:stream';
import { join } from 'pathe';

import type { KaosProcess } from '@superliora/kaos';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BackgroundTaskPersistence,
  ProcessBackgroundTask,
  type BackgroundManager,
  type BackgroundTaskInfo,
} from '../../../src/agent/background';
import {
  agentTask,
  createBackgroundManager,
  registerProcess,
  waitForOutput,
  waitForTerminal,
} from './helpers';
import { isUserCancellation, userCancellationReason } from '../../../src/utils/abort';
import type { SubagentCompletion } from '../../../src/session/subagent/subagent-host';

const completedWorker: SubagentCompletion = {
  status: 'completed',
  result: 'done',
  filesChanged: [],
  context: { agentId: 'agent-child', contextTokens: 12 },
};

function immediateProcess(exitCode: number, stdoutText = ''): KaosProcess {
  return {
    stdin: { write: vi.fn(), end: vi.fn() } as unknown as Writable,
    stdout: Readable.from(stdoutText ? [stdoutText] : []),
    stderr: Readable.from([]),
    pid: 10000 + exitCode,
    exitCode,
    wait: vi.fn().mockResolvedValue(exitCode) as KaosProcess['wait'],
    kill: vi.fn().mockResolvedValue(undefined) as KaosProcess['kill'],
    dispose: vi.fn().mockResolvedValue(undefined) as KaosProcess['dispose'],
  };
}


function processWithStdoutError(message = 'stdout read failed'): KaosProcess {
  const stdout = new PassThrough();
  return {
    stdin: { write: vi.fn(), end: vi.fn() } as unknown as Writable,
    stdout,
    stderr: Readable.from([]),
    pid: 99998,
    exitCode: 0,
    wait: vi.fn(async () => {
      stdout.destroy(new Error(message));
      return 0;
    }) as KaosProcess['wait'],
    kill: vi.fn().mockResolvedValue(undefined) as KaosProcess['kill'],
    dispose: vi.fn().mockResolvedValue(undefined) as KaosProcess['dispose'],
  };
}

function processWithStdoutErrorBeforeWait(message = 'stdout read failed'): {
  proc: KaosProcess;
  failStdout: () => void;
  resolveWait: (exitCode: number) => void;
} {
  const stdout = new PassThrough();
  let currentExitCode: number | null = null;
  let resolveWait: (n: number) => void = () => {};
  const waitPromise = new Promise<number>((resolve) => {
    resolveWait = resolve;
  });
  return {
    proc: {
      stdin: { write: vi.fn(), end: vi.fn() } as unknown as Writable,
      stdout,
      stderr: Readable.from([]),
      pid: 99997,
      get exitCode(): number | null {
        return currentExitCode;
      },
      wait: vi.fn(() => waitPromise) as KaosProcess['wait'],
      kill: vi.fn().mockResolvedValue(undefined) as KaosProcess['kill'],
      dispose: vi.fn().mockResolvedValue(undefined) as KaosProcess['dispose'],
    },
    failStdout: () => {
      stdout.destroy(new Error(message));
    },
    resolveWait: (exitCode) => {
      currentExitCode = exitCode;
      resolveWait(exitCode);
    },
  };
}

function pendingProcess(exitOnKill = 143): {
  proc: KaosProcess;
  killSpy: ReturnType<typeof vi.fn>;
} {
  let resolveWait: (n: number) => void = () => {};
  const waitPromise = new Promise<number>((resolve) => {
    resolveWait = resolve;
  });
  let currentExitCode: number | null = null;
  const killSpy = vi.fn(async () => {
    if (currentExitCode !== null) return;
    currentExitCode = exitOnKill;
    resolveWait(exitOnKill);
  });
  const proc: KaosProcess = {
    stdin: { write: vi.fn(), end: vi.fn() } as unknown as Writable,
    stdout: Readable.from([]),
    stderr: Readable.from([]),
    pid: 54321,
    get exitCode(): number | null {
      return currentExitCode;
    },
    wait: () => waitPromise,
    kill: killSpy as unknown as KaosProcess['kill'],
    dispose: vi.fn().mockResolvedValue(undefined) as KaosProcess['dispose'],
  };
  return { proc, killSpy };
}

function manuallyResolvedProcess(): {
  proc: KaosProcess;
  killSpy: ReturnType<typeof vi.fn>;
  resolve: (exitCode: number) => void;
} {
  let resolveWait: (n: number) => void = () => {};
  const waitPromise = new Promise<number>((resolve) => {
    resolveWait = resolve;
  });
  let currentExitCode: number | null = null;
  const killSpy = vi.fn().mockResolvedValue(undefined);
  const proc: KaosProcess = {
    stdin: { write: vi.fn(), end: vi.fn() } as unknown as Writable,
    stdout: Readable.from([]),
    stderr: Readable.from([]),
    pid: 54324,
    get exitCode(): number | null {
      return currentExitCode;
    },
    wait: () => waitPromise,
    kill: killSpy as unknown as KaosProcess['kill'],
    dispose: vi.fn().mockResolvedValue(undefined) as KaosProcess['dispose'],
  };
  return {
    proc,
    killSpy,
    resolve: (exitCode) => {
      if (currentExitCode !== null) return;
      currentExitCode = exitCode;
      resolveWait(exitCode);
    },
  };
}

function processWithVisibleExitCodeBeforeWait(exitCode = 143): {
  proc: KaosProcess;
  markExited: () => void;
} {
  let currentExitCode: number | null = null;
  const proc: KaosProcess = {
    stdin: { write: vi.fn(), end: vi.fn() } as unknown as Writable,
    stdout: Readable.from([]),
    stderr: Readable.from([]),
    pid: 54322,
    get exitCode(): number | null {
      return currentExitCode;
    },
    wait: () => new Promise<number>(() => {}),
    kill: vi.fn().mockResolvedValue(undefined) as KaosProcess['kill'],
    dispose: vi.fn().mockResolvedValue(undefined) as KaosProcess['dispose'],
  };
  return {
    proc,
    markExited: () => {
      currentExitCode = exitCode;
    },
  };
}

describe('BackgroundManager', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers process tasks and exposes process metadata', () => {
    const { manager } = createBackgroundManager();
    const proc = immediateProcess(0);

    const taskId = registerProcess(manager, proc, 'echo hello', 'test echo');

    expect(manager.getTask(taskId)).toMatchObject({
      taskId,
      kind: 'process',
      command: 'echo hello',
      description: 'test echo',
      pid: proc.pid,
      status: 'running',
    });
  });

  it('registers agent tasks and exposes agent metadata', () => {
    const { manager } = createBackgroundManager();

    const taskId = manager.registerTask(
      agentTask(new Promise(() => {}), 'investigate bug', {
        agentId: 'agent-child',
        subagentType: 'agent',
      }),
    );

    expect(manager.getTask(taskId)).toMatchObject({
      taskId,
      kind: 'agent',
      description: 'investigate bug',
      agentId: 'agent-child',
      subagentType: 'agent',
      status: 'running',
    });
  });

  it('detaches a foreground worker without surrendering its execution ownership', async () => {
    const { manager } = createBackgroundManager();
    const completion = Promise.withResolvers<SubagentCompletion>();
    const parentController = new AbortController();
    const childController = new AbortController();
    const markActiveChildDetached = vi.fn();
    const taskId = manager.registerTask(
      agentTask(completion.promise, 'foreground agent', {
        subagentHost: { markActiveChildDetached },
        abortController: childController,
      }),
      { detached: false, signal: parentController.signal },
    );

    expect(manager.getTask(taskId)).toMatchObject({ detached: false, status: 'running' });
    const waiting = manager.waitForForegroundRelease(taskId);
    await Promise.resolve();
    expect(manager.detach(taskId)).toMatchObject({
      taskId,
      detached: true,
      status: 'running',
      endedAt: null,
    });
    await expect(waiting).resolves.toBe('detached');
    expect(markActiveChildDetached).toHaveBeenCalledTimes(1);
    expect(markActiveChildDetached).toHaveBeenCalledWith('agent-child');

    parentController.abort(userCancellationReason());
    await Promise.resolve();
    expect(childController.signal.aborted).toBe(false);
    expect(manager.getTask(taskId)).toMatchObject({ status: 'running', endedAt: null });

    completion.resolve(completedWorker);
    await expect(manager.wait(taskId)).resolves.toMatchObject({ status: 'completed' });
  });

  it('releases foreground waiters when a foreground task completes', async () => {
    const { agent, manager } = createBackgroundManager();
    const taskId = manager.registerTask(
      agentTask(Promise.resolve(completedWorker), 'foreground agent'),
      { detached: false },
    );

    await expect(manager.waitForForegroundRelease(taskId)).resolves.toBe('terminal');
    expect(manager.getTask(taskId)).toMatchObject({
      detached: false,
      status: 'completed',
    });
    expect(agent.emittedEvents).toEqual([]);
  });

  it('stops foreground tasks from their register-time signal', async () => {
    const { manager } = createBackgroundManager();
    const { proc, killSpy } = pendingProcess();
    const controller = new AbortController();
    const taskId = manager.registerTask(
      new ProcessBackgroundTask(proc, 'sleep 10', 'foreground process', manager.agent.kaos.getcwd()),
      {
        detached: false,
        signal: controller.signal,
      },
    );

    const waiting = manager.waitForForegroundRelease(taskId);
    controller.abort();

    await expect(waiting).resolves.toBe('terminal');
    expect(killSpy).toHaveBeenCalledWith('SIGTERM');
    expect(manager.getTask(taskId)).toMatchObject({
      status: 'killed',
      stopReason: 'Interrupted by user',
    });
  });

  it('forwards foreground signal abort reasons to agent task controllers', async () => {
    const { manager } = createBackgroundManager();
    const foregroundController = new AbortController();
    const subagentController = new AbortController();
    const completion = Promise.withResolvers<SubagentCompletion>();
    const taskId = manager.registerTask(
      agentTask(completion.promise, 'foreground agent', { abortController: subagentController }),
      {
        detached: false,
        signal: foregroundController.signal,
      },
    );

    foregroundController.abort(userCancellationReason());

    await vi.waitFor(() => {
      expect(isUserCancellation(subagentController.signal.reason)).toBe(true);
    });
    expect(manager.getTask(taskId)).toMatchObject({ status: 'running', endedAt: null });
    completion.reject(subagentController.signal.reason);

    const info = await manager.wait(taskId);
    expect(info).toMatchObject({
      status: 'killed',
      stopReason: 'Interrupted by user',
    });
  });

  it('does not count foreground tasks against the detached task limit', () => {
    const { manager } = createBackgroundManager({ maxRunningTasks: 1 });
    manager.registerTask(agentTask(new Promise(() => {}), 'foreground agent'), {
      detached: false,
    });

    manager.registerTask(agentTask(new Promise(() => {}), 'background agent'));

    expect(() => {
      manager.registerTask(agentTask(new Promise(() => {}), 'second background'));
    }).toThrow('Too many background tasks are already running.');
  });

  it('does not count foreground tasks detached later against the background task limit', () => {
    const { manager } = createBackgroundManager({ maxRunningTasks: 1 });
    const taskId = manager.registerTask(
      agentTask(new Promise(() => {}), 'foreground agent'),
      { detached: false },
    );

    manager.detach(taskId);

    manager.registerTask(agentTask(new Promise(() => {}), 'background agent'));

    expect(() => {
      manager.registerTask(agentTask(new Promise(() => {}), 'second background'));
    }).toThrow('Too many background tasks are already running.');
  });

  it('lists active tasks by default', () => {
    const { manager } = createBackgroundManager();
    registerProcess(manager, pendingProcess().proc, 'sleep 60', 'task 1');
    registerProcess(manager, pendingProcess().proc, 'sleep 60', 'task 2');

    expect(manager.list()).toHaveLength(2);
  });

  it('rejects new tasks when maxRunningTasks is reached', () => {
    const { manager } = createBackgroundManager({ maxRunningTasks: 1 });

    registerProcess(manager, pendingProcess().proc, 'sleep 60', 'first task');

    expect(() => {
      registerProcess(manager, pendingProcess().proc, 'sleep 60', 'second task');
    }).toThrow('Too many background tasks are already running.');
    expect(() => {
      manager.registerTask(agentTask(new Promise(() => {}), 'agent task'));
    }).toThrow('Too many background tasks are already running.');
  });

  it('captures process output', async () => {
    const { manager } = createBackgroundManager();
    const taskId = registerProcess(
      manager,
      immediateProcess(0, 'captured output\n'),
      'echo captured output',
      'capture test',
    );

    await waitForOutput(manager, taskId, 'captured output');

    expect(await manager.readOutput(taskId)).toContain('captured output');
  });

  it('fails process tasks when output capture errors after successful exit', async () => {
    const { manager } = createBackgroundManager();
    const taskId = registerProcess(
      manager,
      processWithStdoutError(),
      'ssh example.test',
      'stream error test',
    );

    await expect(manager.wait(taskId)).resolves.toMatchObject({
      kind: 'process',
      status: 'failed',
      exitCode: 0,
      stopReason: 'stdout read failed',
    });
  });

  it('handles process stream errors before process wait settles', async () => {
    const { manager } = createBackgroundManager();
    const { proc, failStdout, resolveWait } = processWithStdoutErrorBeforeWait();
    const taskId = registerProcess(
      manager,
      proc,
      'ssh example.test',
      'stream error before wait test',
    );

    await Promise.resolve();
    failStdout();
    await Promise.resolve();

    expect(await manager.wait(taskId, 0)).toMatchObject({
      kind: 'process',
      status: 'running',
      exitCode: null,
    });

    resolveWait(0);

    await expect(manager.wait(taskId)).resolves.toMatchObject({
      kind: 'process',
      status: 'failed',
      exitCode: 0,
      stopReason: 'stdout read failed',
    });
  });

  it('disposes process resources after a process task completes', async () => {
    const { manager } = createBackgroundManager();
    const dispose = vi.fn();
    const proc = {
      ...immediateProcess(0, 'hello'),
      dispose,
    } as unknown as KaosProcess;
    const taskId = registerProcess(manager, proc, 'echo hello', 'test echo');

    await waitForTerminal(manager, taskId);

    await vi.waitFor(() => {
      expect(dispose).toHaveBeenCalledTimes(1);
    });
  });

  it('transitions process status from exit code', async () => {
    const { manager } = createBackgroundManager();
    const successId = registerProcess(manager, immediateProcess(0), 'echo done', 'ok');
    const failureId = registerProcess(manager, immediateProcess(42), 'exit 42', 'fail');

    expect(await manager.wait(successId)).toMatchObject({
      kind: 'process',
      status: 'completed',
      exitCode: 0,
    });
    expect(await manager.wait(failureId)).toMatchObject({
      kind: 'process',
      status: 'failed',
      exitCode: 42,
    });
  });

  it('does not finalize from a visible process exit code before wait settles', async () => {
    const { manager } = createBackgroundManager();
    const { proc, markExited } = processWithVisibleExitCodeBeforeWait(143);
    const taskId = registerProcess(manager, proc, 'sleep 60', 'external kill test');

    markExited();

    expect(manager.getTask(taskId)).toMatchObject({
      kind: 'process',
      status: 'running',
      exitCode: null,
      endedAt: null,
    });
    expect(await manager.wait(taskId, 1)).toMatchObject({
      kind: 'process',
      status: 'running',
      exitCode: null,
    });
  });

  it('stop kills a running process and records the stop reason', async () => {
    const { manager } = createBackgroundManager();
    const { proc, killSpy } = pendingProcess(143);
    const taskId = registerProcess(manager, proc, 'sleep 60', 'kill test');

    const result = await manager.stop(taskId, 'user requested');

    expect(result).toMatchObject({
      status: 'killed',
      stopReason: 'user requested',
      exitCode: 143,
    });
    expect(killSpy).toHaveBeenCalledWith('SIGTERM');
  });

  it('disposes process resources after a stopped process task settles', async () => {
    const { manager } = createBackgroundManager();
    const { proc, killSpy } = pendingProcess(143);
    const dispose = vi.fn();
    const disposableProc = {
      ...proc,
      dispose,
    } as unknown as KaosProcess;
    const taskId = registerProcess(manager, disposableProc, 'sleep 60', 'kill test');

    await manager.stop(taskId, 'user requested');

    expect(killSpy).toHaveBeenCalledWith('SIGTERM');
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('stop normalizes blank reasons', async () => {
    const { manager } = createBackgroundManager();
    const { proc, resolve } = manuallyResolvedProcess();
    const taskId = registerProcess(manager, proc, 'sleep 60', 'blank reason test');

    const stopPromise = manager.stop(taskId, '   ');
    resolve(0);
    const result = await stopPromise;

    expect(result).toMatchObject({ status: 'killed' });
    expect(result?.stopReason).toBeUndefined();
  });

  it('stop keeps graceful process shutdown classified as killed', async () => {
    const { manager } = createBackgroundManager();
    const { proc, killSpy, resolve } = manuallyResolvedProcess();
    const taskId = registerProcess(manager, proc, 'sleep 60', 'process race test');

    const stopPromise = manager.stop(taskId, 'user requested');
    resolve(0);
    const result = await stopPromise;

    expect(result).toMatchObject({
      status: 'killed',
      stopReason: 'user requested',
      exitCode: 0,
    });
    expect(killSpy).toHaveBeenCalledWith('SIGTERM');
    expect(killSpy).not.toHaveBeenCalledWith('SIGKILL');
  });

  it('persists graceful process shutdown as killed when stop was requested', async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), 'kimi-bg-stop-race-'));
    try {
      const writer = createBackgroundManager({ sessionDir }).manager;
      const { proc, resolve } = manuallyResolvedProcess();
      const taskId = registerProcess(writer, proc, 'sleep 60', 'persisted race');

      const stopPromise = writer.stop(taskId, 'user requested');
      resolve(0);
      await stopPromise;

      const reader = createBackgroundManager({ sessionDir }).manager;
      await reader.loadFromDisk();

      expect(reader.getTask(taskId)).toMatchObject({
        kind: 'process',
        status: 'killed',
        exitCode: 0,
        stopReason: 'user requested',
      });
    } finally {
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  it('stop preserves agent completion when it wins the stop race', async () => {
    const { manager } = createBackgroundManager();
    const completion = Promise.withResolvers<SubagentCompletion>();
    const controller = new AbortController();
    const abort = vi.spyOn(controller, 'abort');
    const taskId = manager.registerTask(
      agentTask(completion.promise, 'agent race test', { abortController: controller }),
    );

    const stopPromise = manager.stop(taskId, 'user requested');
    completion.resolve({ ...completedWorker, result: 'finished naturally' });
    const result = await stopPromise;

    expect(result).toMatchObject({ status: 'completed' });
    expect(result?.stopReason).toBeUndefined();
    expect(await manager.readOutput(taskId)).toContain('finished naturally');
    expect(abort).toHaveBeenCalled();
  });

  it('stop preserves agent failure when a non-abort rejection wins', async () => {
    const { manager } = createBackgroundManager();
    const completion = Promise.withResolvers<SubagentCompletion>();
    const controller = new AbortController();
    const abort = vi.spyOn(controller, 'abort');
    const taskId = manager.registerTask(
      agentTask(completion.promise, 'agent failure race test', { abortController: controller }),
    );

    const stopPromise = manager.stop(taskId, 'user requested');
    completion.reject(new Error('model failed'));
    const result = await stopPromise;

    expect(result).toMatchObject({
      status: 'failed',
      stopReason: 'model failed',
    });
    expect(abort).toHaveBeenCalled();
  });

  it('stop waits for the worker completion to reject after abort acknowledgement', async () => {
    const { agent, manager } = createBackgroundManager();
    const completion = Promise.withResolvers<SubagentCompletion>();
    const controller = new AbortController();
    const taskId = manager.registerTask(
      agentTask(completion.promise, 'agent abort test', { abortController: controller }),
    );
    let settled = false;
    const stopped = manager.stop(taskId, 'user requested').then((info) => {
      settled = true;
      return info;
    });

    await vi.waitFor(() => {
      expect(controller.signal.aborted).toBe(true);
    });
    expect(settled).toBe(false);
    expect(manager.getTask(taskId)).toMatchObject({ status: 'running', endedAt: null });
    expect(agent.emittedEvents.filter((event) => event.type === 'background.task.terminated')).toEqual([]);
    completion.reject(controller.signal.reason);

    await expect(stopped).resolves.toMatchObject({
      status: 'killed',
      stopReason: 'user requested',
    });
    expect(settled).toBe(true);
    expect(agent.emittedEvents.filter((event) => event.type === 'background.task.terminated')).toHaveLength(1);
  });

  it('keeps an aborted worker owned beyond the old grace window until actual settlement', async () => {
    vi.useFakeTimers();
    const { agent, manager } = createBackgroundManager();
    const completion = Promise.withResolvers<SubagentCompletion>();
    const controller = new AbortController();
    const taskId = manager.registerTask(
      agentTask(completion.promise, 'slow shutdown', { abortController: controller }),
      { detached: false },
    );
    let released = false;
    const release = manager.waitForForegroundRelease(taskId).then(() => {
      released = true;
    });
    let stopped = false;
    const stop = manager.stop(taskId, 'user requested').then(() => {
      stopped = true;
    });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(controller.signal.aborted).toBe(true);
    expect(manager.getTask(taskId)).toMatchObject({ status: 'running', endedAt: null });
    expect(stopped).toBe(false);
    expect(released).toBe(false);
    expect(agent.emittedEvents).toEqual([]);

    completion.resolve({ ...completedWorker, result: 'provider finished cleanup' });
    await stop;
    await release;
    expect(manager.getTask(taskId)).toMatchObject({ status: 'completed' });
    expect(stopped).toBe(true);
    expect(released).toBe(true);
  });

  it('wait resolves on completion and returns the current snapshot on timeout', async () => {
    const { manager } = createBackgroundManager();
    const completedId = registerProcess(manager, immediateProcess(0), 'echo fast', 'wait test');

    expect(await manager.wait(completedId, 5_000)).toMatchObject({ status: 'completed' });

    const runningId = registerProcess(manager, pendingProcess().proc, 'sleep 60', 'timeout');
    expect(await manager.wait(runningId, 0)).toMatchObject({ status: 'running' });
  });

  it('clears task deadline timers when completion wins the race', async () => {
    vi.useFakeTimers();
    const { manager } = createBackgroundManager();
    const taskId = manager.registerTask(
      agentTask(Promise.resolve(completedWorker), 'fast deadline task'),
      { timeoutMs: 60_000 },
    );

    await expect(manager.wait(taskId, 60_000)).resolves.toMatchObject({ status: 'completed' });
    expect(vi.getTimerCount()).toBe(0);
  });


  it('returns undefined or empty output for unknown task ids', async () => {
    const { manager } = createBackgroundManager();

    expect(manager.getTask('bash-nonexist')).toBeUndefined();
    expect(await manager.readOutput('bash-nonexist')).toBe('');
    expect(await manager.stop('bash-nonexist')).toBeUndefined();
  });

  it('stop returns terminal info for an already-exited task', async () => {
    const { manager } = createBackgroundManager();
    const taskId = registerProcess(manager, immediateProcess(0), 'echo done', 'already done');

    await manager.wait(taskId);

    expect(await manager.stop(taskId, 'too late')).toMatchObject({
      status: 'completed',
      stopReason: undefined,
    });
  });

  it('getTask on an unknown id does not create persisted state', async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), 'kimi-bg-mgr-missing-'));
    try {
      const { manager } = createBackgroundManager({ sessionDir });

      expect(manager.getTask('bash-bogusss0')).toBeUndefined();

      expect(await new BackgroundTaskPersistence(sessionDir).listTasks()).toEqual([]);
    } finally {
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  it('launches a real process and waits to completion', async () => {
    const { spawn } = await import('node:child_process');
    const { manager } = createBackgroundManager();
    const child = spawn(
      process.execPath,
      ['-e', "process.stdout.write('bg-ok\\n')"],
      { stdio: 'pipe' },
    );
    const proc: KaosProcess = {
      stdin: { write: vi.fn(), end: vi.fn() } as unknown as Writable,
      stdout: child.stdout,
      stderr: child.stderr,
      pid: child.pid ?? 0,
      get exitCode(): number | null {
        return child.exitCode;
      },
      wait: () =>
        new Promise<number>((resolve) => {
          child.on('exit', (code) => {
            resolve(code ?? 0);
          });
      }),
      kill: vi.fn(async (signal?: NodeJS.Signals) => {
        child.kill(signal ?? 'SIGTERM');
      }) as unknown as KaosProcess['kill'],
      dispose: vi.fn(async () => {
        child.stdin?.destroy();
        child.stdout?.destroy();
        child.stderr?.destroy();
      }) as KaosProcess['dispose'],
    };

    const taskId = registerProcess(manager, proc, 'node -e <stdout bg-ok>', 'real worker');
    const info = await manager.wait(taskId, 10_000);

    expect(info).toMatchObject({ kind: 'process', status: 'completed', exitCode: 0 });
    expect(await manager.readOutput(taskId)).toContain('bg-ok');
  }, 15_000);
});

describe('background ownership and actual settlement', () => {
  it('keeps a stopped process running until process wait and disposal have both settled', async () => {
    const { agent, manager } = createBackgroundManager();
    const { proc, killSpy, resolve } = manuallyResolvedProcess();
    const cleanup = Promise.withResolvers<void>();
    const dispose = vi.fn(() => cleanup.promise);
    Object.assign(proc, { dispose });
    const taskId = registerProcess(manager, proc, 'sleep 60', 'process cleanup');
    let stopped = false;
    const stop = manager.stop(taskId, 'user requested').then((info) => {
      stopped = true;
      return info;
    });

    await vi.waitFor(() => {
      expect(killSpy).toHaveBeenCalledWith('SIGTERM');
    });
    expect(stopped).toBe(false);
    expect(dispose).not.toHaveBeenCalled();
    expect(manager.getTask(taskId)).toMatchObject({ status: 'running', endedAt: null });

    resolve(143);
    await vi.waitFor(() => {
      expect(dispose).toHaveBeenCalled();
    });
    expect(stopped).toBe(false);
    expect(manager.getTask(taskId)).toMatchObject({ status: 'running', endedAt: null });
    expect(agent.emittedEvents.filter((event) => event.type === 'background.task.terminated')).toEqual([]);

    cleanup.resolve();
    await expect(stop).resolves.toMatchObject({
      status: 'killed',
      exitCode: 143,
      stopReason: 'user requested',
    });
    expect(stopped).toBe(true);
    expect(agent.emittedEvents.filter((event) => event.type === 'background.task.terminated')).toHaveLength(1);
  });

  it('leaves detached workers independent of foreground cancellation', async () => {
    const { manager } = createBackgroundManager();
    const foreground = Promise.withResolvers<SubagentCompletion>();
    const detached = Promise.withResolvers<SubagentCompletion>();
    const parentController = new AbortController();
    const foregroundController = new AbortController();
    const detachedController = new AbortController();
    const foregroundId = manager.registerTask(
      agentTask(foreground.promise, 'foreground worker', { abortController: foregroundController }),
      { detached: false, signal: parentController.signal },
    );
    const detachedId = manager.registerTask(
      agentTask(detached.promise, 'independent worker', {
        agentId: 'agent-independent',
        abortController: detachedController,
      }),
      { detached: true, signal: parentController.signal },
    );

    parentController.abort(userCancellationReason());
    await vi.waitFor(() => {
      expect(foregroundController.signal.aborted).toBe(true);
    });
    expect(detachedController.signal.aborted).toBe(false);
    expect(manager.getTask(foregroundId)).toMatchObject({ status: 'running', endedAt: null });
    expect(manager.getTask(detachedId)).toMatchObject({ status: 'running', endedAt: null });

    detached.resolve({
      status: 'completed',
      result: 'independent result',
      filesChanged: ['src/independent.ts'],
      context: { agentId: 'agent-independent', contextTokens: 24 },
    });
    await expect(manager.wait(detachedId)).resolves.toMatchObject({ status: 'completed' });
    expect(await manager.readOutput(detachedId)).toContain('independent result');
    expect(manager.getTask(foregroundId)).toMatchObject({ status: 'running', endedAt: null });

    foreground.reject(foregroundController.signal.reason);
    await expect(manager.wait(foregroundId)).resolves.toMatchObject({
      status: 'killed',
      stopReason: 'Interrupted by user',
    });
  });

  it('retains a cancelled worker admission slot until its provider actually settles', async () => {
    const { manager } = createBackgroundManager({ maxRunningTasks: 1 });
    const completion = Promise.withResolvers<SubagentCompletion>();
    const controller = new AbortController();
    const taskId = manager.registerTask(
      agentTask(completion.promise, 'owned shutdown', { abortController: controller }),
    );
    const stop = manager.stop(taskId, 'user requested');
    await vi.waitFor(() => {
      expect(controller.signal.aborted).toBe(true);
    });

    expect(() => manager.registerTask(agentTask(Promise.resolve(completedWorker), 'too early')))
      .toThrow('Too many background tasks are already running.');
    completion.reject(controller.signal.reason);
    await stop;

    const nextId = manager.registerTask(agentTask(Promise.resolve(completedWorker), 'next worker'));
    await expect(manager.wait(nextId)).resolves.toMatchObject({ status: 'completed' });
  });

  it('restores a settled worker and its observed result from persisted records', async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), 'native-worker-persistence-'));
    try {
      const writer = createBackgroundManager({ sessionDir }).manager;
      const outcome: SubagentCompletion = {
        status: 'completed',
        result: 'changed native worker output',
        filesChanged: ['src/worker.ts'],
        context: { agentId: 'agent-persisted', contextTokens: 48 },
      };
      const taskId = writer.registerTask(
        agentTask(Promise.resolve(outcome), 'persist worker', { agentId: 'agent-persisted' }),
      );
      await expect(writer.wait(taskId)).resolves.toMatchObject({ status: 'completed' });

      const { agent, manager: reader } = createBackgroundManager({ sessionDir });
      await reader.loadFromDisk();
      await reader.reconcile();

      expect(reader.getTask(taskId)).toMatchObject({
        kind: 'agent',
        agentId: 'agent-persisted',
        status: 'completed',
      });
      expect(JSON.parse(await reader.readOutput(taskId))).toEqual(outcome);
      expect(agent.emittedEvents).toEqual([]);
    } finally {
      await rm(sessionDir, { recursive: true, force: true });
    }
  });
});

describe('waitForActiveTasks', () => {
  const isAgent = (info: BackgroundTaskInfo): boolean => info.kind === 'agent';

  it('resolves immediately when no task matches the predicate', async () => {
    const { manager } = createBackgroundManager();
    registerProcess(manager, immediateProcess(0), 'noop', 'proc');
    await expect(manager.waitForActiveTasks(isAgent)).resolves.toBeUndefined();
  });

  it('waits until a matching agent task reaches a terminal state', async () => {
    const { manager } = createBackgroundManager();
    const done = Promise.withResolvers<SubagentCompletion>();
    manager.registerTask(agentTask(done.promise, 'agent'));

    let settled = false;
    const wait = manager.waitForActiveTasks(isAgent).then(() => {
      settled = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);

    done.resolve({ ...completedWorker, result: 'ok' });
    await wait;
    expect(settled).toBe(true);
  });
});
