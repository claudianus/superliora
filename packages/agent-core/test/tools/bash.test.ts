import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable, type Writable } from 'node:stream';

import { LocalKaos, type Environment, type KaosProcess } from '@superliora/kaos';
import { describe, expect, it, vi } from 'vitest';

import { type BashInput, BashInputSchema, BashTool } from '../../src/tools/builtin/shell/bash';
import { isSessionWorktreeOwned } from '../../src/session/worktree';
import { createBackgroundManager, registerProcess } from '../agent/background/helpers';
import { createFakeKaos } from './fixtures/fake-kaos';
import { executeTool } from './fixtures/execute-tool';

const posixEnv: Environment = {
  osKind: 'Linux',
  osArch: 'arm64',
  osVersion: 'test',
  shellPath: '/bin/bash',
  shellName: 'bash',
};

const windowsBashEnv: Environment = {
  osKind: 'Windows',
  osArch: 'x64',
  osVersion: 'test',
  shellPath: 'C:\\Program Files\\Git\\bin\\bash.exe',
  shellName: 'bash',
};

async function closeStreams(streams: readonly (Readable | Writable)[]): Promise<void> {
  await Promise.all(streams.map(async (stream) => {
    if (stream.closed) return;
    const closed = once(stream, 'close');
    stream.destroy();
    await closed;
  }));
}

function processWithOutput(
  options: {
  readonly stdout?: string | Buffer;
  readonly stderr?: string | Buffer;
  readonly exitCode?: number | null;
  readonly wait?: () => Promise<number | null>;
  readonly kill?: (signal?: NodeJS.Signals) => Promise<void>;
  } = {},
): KaosProcess {
  const exitCode = options.exitCode === undefined ? 0 : options.exitCode;
  const stdout = Readable.from(options.stdout === undefined ? [] : [options.stdout]);
  const stderr = Readable.from(options.stderr === undefined ? [] : [options.stderr]);
  const stdin = new PassThrough();
  return {
    stdin,
    stdout,
    stderr,
    pid: 123,
    exitCode,
    wait: vi.fn(options.wait ?? (async () => exitCode)),
    kill: vi.fn(options.kill ?? (async () => {})),
    dispose: vi.fn(() => closeStreams([stdin, stdout, stderr])),
  };
}

function processWithInterleavedOutput(
  events: ReadonlyArray<{
    readonly stream: 'stdout' | 'stderr';
    readonly text: string;
    readonly delayMs: number;
  }>,
  exitCode = 0,
): KaosProcess {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const lastDelay = Math.max(...events.map((event) => event.delayMs), 0);
  const waitPromise = new Promise<number>((resolve) => {
    for (const event of events) {
      setTimeout(() => {
        const target = event.stream === 'stdout' ? stdout : stderr;
        target.write(event.text);
      }, event.delayMs);
    }
    setTimeout(() => {
      stdout.end();
      stderr.end();
      resolve(exitCode);
    }, lastDelay + 1);
  });

  return {
    stdin: { end: vi.fn(), write: vi.fn() } as unknown as Writable,
    stdout,
    stderr,
    pid: 124,
    exitCode,
    wait: vi.fn(async () => waitPromise),
    kill: vi.fn(async () => {}),
    dispose: vi.fn(async () => {
      stdout.destroy();
      stderr.destroy();
    }),
  };
}

function pendingProcess(): {
  readonly proc: KaosProcess;
  readonly finish: (exitCode?: number) => void;
} {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();
  let resolveWait: (exitCode: number) => void = () => {};
  let currentExitCode: number | null = null;
  const waitPromise = new Promise<number>((resolve) => {
    resolveWait = resolve;
  });
  const finish = (exitCode = 0): void => {
    if (currentExitCode !== null) return;
    currentExitCode = exitCode;
    stdout.end();
    stderr.end();
    resolveWait(exitCode);
  };
  return {
    proc: {
      stdin,
      stdout,
      stderr,
      pid: 125,
      get exitCode(): number | null {
        return currentExitCode;
      },
      wait: vi.fn(async () => waitPromise),
      kill: vi.fn(async () => {
        finish(143);
      }) as KaosProcess['kill'],
      dispose: vi.fn(() => closeStreams([stdin, stdout, stderr])),
    },
    finish,
  };
}

function processWithVisibleExitBeforeWait(exitCode = 0): {
  proc: KaosProcess;
  finishWait: () => void;
  markExited: () => void;
} {
  let currentExitCode: number | null = null;
  let resolveWait: (code: number) => void = () => {};
  const waitPromise = new Promise<number>((resolve) => {
    resolveWait = resolve;
  });
  const proc: KaosProcess = {
    stdin: { end: vi.fn(), write: vi.fn() } as unknown as Writable,
    stdout: Readable.from([]),
    stderr: Readable.from([]),
    pid: 125,
    get exitCode(): number | null {
      return currentExitCode;
    },
    wait: vi.fn(async () => waitPromise),
    kill: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
  };

  return {
    proc,
    finishWait: () => {
      resolveWait(exitCode);
    },
    markExited: () => {
      currentExitCode = exitCode;
    },
  };
}


function processWithStreamError(options: {
  readonly stdoutError?: Error;
  readonly stderrError?: Error;
  readonly exitCode?: number;
} = {}): KaosProcess {
  const exitCode = options.exitCode ?? 0;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const waitPromise = new Promise<number>((resolve) => {
    setTimeout(() => {
      if (options.stdoutError !== undefined) {
        stdout.emit('error', options.stdoutError);
      } else {
        stdout.end();
      }
      if (options.stderrError !== undefined) {
        stderr.emit('error', options.stderrError);
      } else {
        stderr.end();
      }
      resolve(exitCode);
    }, 1);
  });
  return {
    stdin: { end: vi.fn(), write: vi.fn() } as unknown as Writable,
    stdout,
    stderr,
    pid: 128,
    exitCode,
    wait: vi.fn(async () => waitPromise),
    kill: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
  };
}

function processWithOpenStreamsThatExitOnKill(): KaosProcess {
  let currentExitCode: number | null = null;
  let resolveWait: (code: number) => void = () => {};
  const waitPromise = new Promise<number>((resolve) => {
    resolveWait = resolve;
  });
  const stdout = new PassThrough();
  const stderr = new PassThrough();

  return {
    stdin: { end: vi.fn(), write: vi.fn() } as unknown as Writable,
    stdout,
    stderr,
    pid: 127,
    get exitCode(): number | null {
      return currentExitCode;
    },
    wait: vi.fn(async () => waitPromise),
    kill: vi.fn(async () => {
      currentExitCode = 143;
      resolveWait(143);
    }),
    dispose: vi.fn(async () => {
      stdout.destroy();
      stderr.destroy();
    }),
  };
}

function context(args: BashInput, signal = new AbortController().signal) {
  return { turnId: '0', toolCallId: 'call_bash', args, signal };
}

function bashTool(
  kaos: ConstructorParameters<typeof BashTool>[0],
  cwd = '/workspace',
  manager = createBackgroundManager().manager,
  options?: ConstructorParameters<typeof BashTool>[3],
): BashTool {
  return new BashTool(kaos, cwd, manager, options);
}

describe('BashTool', () => {
  it('waits for requested sandbox setup and does not spawn when setup fails', async () => {
    const ready = Promise.withResolvers<void>();
    const execWithEnv = vi.fn().mockResolvedValue(processWithOutput());
    const tool = bashTool(createFakeKaos({ execWithEnv, osEnv: posixEnv }), '/workspace', createBackgroundManager().manager, {
      ensureSandboxReady: () => ready.promise,
    });
    const running = executeTool(tool, context({ command: 'echo safe' }));
    expect(execWithEnv).not.toHaveBeenCalled();
    ready.resolve();
    await expect(running).resolves.toMatchObject({ isError: false });
    expect(execWithEnv).toHaveBeenCalledOnce();
    execWithEnv.mockClear();
    const unavailable = bashTool(createFakeKaos({ execWithEnv, osEnv: posixEnv }), '/workspace', createBackgroundManager().manager, {
      ensureSandboxReady: async () => { throw new Error('Requested sandbox unavailable'); },
    });
    await expect(executeTool(unavailable, context({ command: 'echo unsafe' }))).rejects.toThrow('Requested sandbox unavailable');
    expect(execWithEnv).not.toHaveBeenCalled();
  });

  it('accepts explicit process deadlines without arbitrary caps', () => {

    expect(BashInputSchema.safeParse({ command: 'echo hello' }).success).toBe(true);
    expect(BashInputSchema.safeParse({ command: '' }).success).toBe(false);
    expect(BashInputSchema.safeParse({ command: 'echo x', timeout: 0 }).success).toBe(false);
    expect(BashInputSchema.safeParse({ command: 'echo x', timeout: 300 }).success).toBe(true);
    expect(BashInputSchema.safeParse({ command: 'echo x', timeout: 301 }).success).toBe(true);
    expect(BashInputSchema.safeParse({ command: 'echo x', timeout: 300_000 }).success).toBe(true);
    expect(BashInputSchema.safeParse({ command: 'echo x', timeout: 300_001 }).success).toBe(true);
    expect(
      BashInputSchema.safeParse({
        command: 'watch',
        run_in_background: true,
        description: 'watch files',
        timeout: 86_400,
      }).success,
    ).toBe(true);
    expect(
      BashInputSchema.safeParse({
        command: 'watch',
        run_in_background: true,
        description: 'watch files',
        timeout: 86_401,
      }).success,
    ).toBe(true);
    expect(
      BashInputSchema.safeParse({
        command: 'watch',
        run_in_background: true,
        description: 'watch files',
        timeout: 600_000,
      }).success,
    ).toBe(true);
    expect(
      BashInputSchema.safeParse({
        command: 'watch',
        run_in_background: true,
        description: 'watch files',
        disable_timeout: true,
      }).success,
    ).toBe(true);
  });



  it('interprets explicit timeout values as seconds at runtime', async () => {
    vi.useFakeTimers();
    try {
      let resolveWait: (code: number) => void = () => {};
      const waitPromise = new Promise<number>((resolve) => {
        resolveWait = resolve;
      });
      const proc = processWithOutput({
        wait: async () => waitPromise,
        kill: async () => {
          resolveWait(143);
        },
      });
      const tool = bashTool(
        createFakeKaos({ execWithEnv: vi.fn().mockResolvedValue(proc), osEnv: posixEnv }),
        '/workspace',
      );

      const running = executeTool(tool, context({ command: 'sleep 3', timeout: 2 }));
      await vi.advanceTimersByTimeAsync(1_999);
      expect(proc.kill).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      const result = await running;

      expect(proc.kill).toHaveBeenCalled();
      expect(result.output).toContain('Command killed by timeout (2s)');
    } finally {
      vi.useRealTimers();
    }
  });


  it('runs through execWithEnv, injects cwd, noninteractive env, and closes stdin', async () => {
    const proc = processWithOutput({ stdout: 'ok\n' });
    const execWithEnv = vi.fn().mockResolvedValue(proc);
    const tool = bashTool(
      createFakeKaos({ execWithEnv, osEnv: posixEnv }),
      '/workspace',
      createBackgroundManager().manager,
    );

    const result = await executeTool(tool, context({ command: 'printf ok', timeout: 60 }));

    expect(execWithEnv).toHaveBeenCalledTimes(1);
    const [argv, env] = execWithEnv.mock.calls[0]!;
    expect(argv).toEqual(['/bin/bash', '-c', "cd '/workspace' && printf ok"]);
    expect(env).toMatchObject({
      NO_COLOR: '1',
      TERM: 'dumb',
    });
    expect(proc.stdin.writableEnded).toBe(true);
    expect(result).toMatchObject({
      output: 'ok\n',
      isError: false,
      message: 'Command executed successfully.',
    });
  });

  it('applies cwd and noninteractive env to a native shell and delivers stdin EOF', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'liora-bash-env-'));
    const manager = createBackgroundManager().manager;
    try {
      const kaos = await LocalKaos.create();
      // Let the selected native shell render cwd/SHELL: Git Bash exposes MSYS
      // aliases (/c/... and /bin/bash.exe), not the host's Windows path strings.
      const expectedOutput = execFileSync(
        kaos.osEnv.shellPath,
        ['-c', 'printf "%s\\n" "$(pwd -P)" 1 dumb "$SHELL"'],
        {
          cwd: directory,
          env: { ...process.env, SHELL: kaos.osEnv.shellPath },
          encoding: 'utf8',
        },
      );
      const tool = bashTool(kaos, kaos.getcwd(), manager);
      const result = await executeTool(tool, context({
        command: 'printf "%s\\n" "$(pwd -P)" "$NO_COLOR" "$TERM" "$SHELL"; if read -r input; then exit 42; fi; printf "stdin-eof\\n"',
        cwd: directory,
        timeout: 60,
      }));

      expect(result).toMatchObject({
        isError: false,
        output: `${expectedOutput}stdin-eof\n`,
      });
      expect(isSessionWorktreeOwned(directory, directory)).toBe(false);
    } finally {
      await manager.stopAll('test teardown');
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('uses args.cwd when provided', async () => {
    const execWithEnv = vi.fn().mockResolvedValue(processWithOutput({ stdout: 'sub\n' }));
    const tool = bashTool(
      createFakeKaos({ execWithEnv, osEnv: posixEnv }),
      '/workspace',
      createBackgroundManager().manager,
    );

    await executeTool(tool, context({ command: 'pwd', cwd: '/tmp/project', timeout: 60 }));

    expect(execWithEnv.mock.calls[0]?.[0]).toEqual(['/bin/bash', '-c', "cd '/tmp/project' && pwd"]);
  });

  it('uses Git Bash semantics on Windows', async () => {
    const proc = processWithOutput({ stdout: 'ok\n' });
    const execWithEnv = vi.fn().mockResolvedValue(proc);
    const tool = bashTool(
      createFakeKaos({ execWithEnv, osEnv: windowsBashEnv }),
      'C:\\Users\\me\\project',
    );

    const result = await executeTool(tool, context({ command: 'echo ok 2>nul', timeout: 60 }));

    expect(execWithEnv).toHaveBeenCalledTimes(1);
    const [argv, env] = execWithEnv.mock.calls[0]!;
    expect(argv).toEqual([
      'C:\\Program Files\\Git\\bin\\bash.exe',
      '-c',
      "cd '/c/Users/me/project' && echo ok 2>/dev/null",
    ]);
    expect(env).toMatchObject({ SHELL: 'C:\\Program Files\\Git\\bin\\bash.exe' });
    expect(result).toMatchObject({
      output: 'ok\n',
      isError: false,
      message: 'Command executed successfully.',
    });
  });

  it('returns stderr and marks non-zero exit codes as tool errors', async () => {
    const tool = bashTool(
      createFakeKaos({
        execWithEnv: vi
          .fn()
          .mockResolvedValue(processWithOutput({ stderr: 'boom\n', exitCode: 2 })),
        osEnv: posixEnv,
      }),
      '/workspace',
    );

    const result = await executeTool(tool, context({ command: 'exit 2', timeout: 60 }));

    expect(result).toMatchObject({
      isError: true,
      message: 'Command failed with exit code: 2.',
      brief: 'Failed with exit code: 2',
    });
    expect(result.output).toContain('boom\n');
    expect(result.output).toContain('Command failed with exit code: 2.');
  });

  it('returns both stdout and stderr when a command succeeds', async () => {
    const tool = bashTool(
      createFakeKaos({
        execWithEnv: vi
          .fn()
          .mockResolvedValue(processWithOutput({ stdout: 'out\n', stderr: 'warn\n' })),
        osEnv: posixEnv,
      }),
      '/workspace',
    );

    const result = await executeTool(tool, context({ command: 'mixed', timeout: 60 }));

    expect(result).toMatchObject({
      output: 'out\nwarn\n',
      isError: false,
      message: 'Command executed successfully.',
    });
  });

  it('returns both stdout and stderr when a command fails', async () => {
    const tool = bashTool(
      createFakeKaos({
        execWithEnv: vi.fn().mockResolvedValue(
          processWithOutput({
            stdout: 'partial\n',
            stderr: 'boom\n',
            exitCode: 2,
          }),
        ),
        osEnv: posixEnv,
      }),
      '/workspace',
    );

    const result = await executeTool(tool, context({ command: 'mixed fail', timeout: 60 }));

    expect(result).toMatchObject({
      isError: true,
      message: 'Command failed with exit code: 2.',
      brief: 'Failed with exit code: 2',
    });
    expect(result.output).toContain('partial\nboom\n');
    expect(result.output).toContain('Command failed with exit code: 2.');
  });

  it('returns the actual native spawn rejection without registering a task or holding cwd ownership', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'liora-bash-spawn-'));
    const missingCwd = join(directory, 'missing-directory');
    const manager = createBackgroundManager().manager;
    try {
      const kaos = await LocalKaos.create();
      const tool = bashTool(kaos, directory, manager);
      const result = await executeTool(tool, context({
        command: 'printf should-not-run',
        cwd: missingCwd,
        timeout: 60,
      }));
      expect(result.isError).toBe(true);
      expect(result.output).toContain(`spawn ${kaos.osEnv.shellPath}`);
      expect(result.output).toContain('ENOENT');
      expect(result.output).not.toContain('should-not-run');
      expect(result.output).not.toContain('exit code:');
      expect(manager.list(false)).toEqual([]);
      expect(isSessionWorktreeOwned(directory, directory)).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('retains an uncertain foreground wait failure until the actual native process is stopped', async () => {
    const kaos = await LocalKaos.create();
    const native = await kaos.exec(process.execPath, '-e', "require('node:net').createServer().listen(0, '127.0.0.1', () => process.stdout.write('ready\\n'))");
    const ready = once(native.stdout, 'data');
    let firstWait = true;
    const proc: KaosProcess = {
      stdin: native.stdin, stdout: native.stdout, stderr: native.stderr, pid: native.pid,
      get exitCode() { return native.exitCode; },
      get resourcesSettled() { return native.resourcesSettled; },
      wait: async () => {
        if (firstWait) {
          firstWait = false;
          await ready;
          throw new Error('transport lost exit confirmation');
        }
        return native.wait();
      },
      kill: (signal) => native.kill(signal),
      dispose: () => native.dispose(),
    };
    const manager = createBackgroundManager().manager;
    const tool = bashTool(createFakeKaos({ execWithEnv: async () => proc, osEnv: posixEnv }), kaos.getcwd(), manager);
    try {
      const result = await executeTool(tool, context({ command: 'native process with uncertain wait', timeout: 60 }));
      expect(result.isError).toBe(true);
      expect(result.output).toContain('ready');
      expect(proc.exitCode).toBeNull();
      expect(proc.resourcesSettled).toBe(false);
      expect(() => process.kill(native.pid!, 0)).not.toThrow();
      const task = manager.list(false)[0]!;
      expect(task.status).toBe('failed');
      await manager.stop(task.taskId);
      expect(native.resourcesSettled).toBe(true);
      expect(native.stdin.closed).toBe(true);
      expect(native.stdout.closed).toBe(true);
      expect(native.stderr.closed).toBe(true);
    } finally {
      await native.kill('SIGKILL');
      await native.wait();
      await native.dispose();
      await manager.stopAll('test teardown');
    }
  });

  it('preserves foreground stdout and stderr arrival order', async () => {
    vi.useFakeTimers();
    try {
      const proc = processWithInterleavedOutput([
        { stream: 'stderr', text: 'err-first\n', delayMs: 0 },
        { stream: 'stdout', text: 'out-second\n', delayMs: 5 },
        { stream: 'stderr', text: 'err-third\n', delayMs: 10 },
      ]);
      const tool = bashTool(
        createFakeKaos({
          execWithEnv: vi.fn().mockResolvedValue(proc),
          osEnv: posixEnv,
        }),
        '/workspace',
      );

      const resultPromise = executeTool(tool, context({ command: 'mixed', timeout: 60 }));
      await vi.advanceTimersByTimeAsync(11);

      const result = await resultPromise;
      expect(result).toMatchObject({
        isError: false,
        output: 'err-first\nout-second\nerr-third\n',
        message: 'Command executed successfully.',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('can detach a foreground command through the background manager', async () => {
    const { proc, finish } = pendingProcess();
    const manager = createBackgroundManager().manager;
    const tool = bashTool(
      createFakeKaos({
        execWithEnv: vi.fn().mockResolvedValue(proc),
        osEnv: posixEnv,
      }),
      '/workspace',
      manager,
    );

    const running = executeTool(tool, context({ command: 'sleep 10', timeout: 60 }));
    await vi.waitFor(() => {
      expect(manager.list(false)).toHaveLength(1);
    });
    const task = manager.list(false)[0]!;
    await vi.waitFor(() => {
      expect((proc.stdout as PassThrough).listenerCount('data')).toBeGreaterThanOrEqual(1);
    });
    (proc.stdout as PassThrough).write('before detach\n');

    expect(task).toMatchObject({
      kind: 'process',
      detached: false,
      command: 'sleep 10',
    });

    manager.detach(task.taskId);
    const result = await running;
    (proc.stdout as PassThrough).write('after detach\n');

    expect(result).toMatchObject({ isError: false });
    expect(result.output).toContain('before detach\n');
    expect(result.output).not.toContain('after detach\n');
    expect(result.output).toContain(`task_id: ${task.taskId}`);
    expect(result.output).toContain('automatic_notification: true');
    expect(manager.getTask(task.taskId)).toMatchObject({ detached: true });
    await vi.waitFor(async () => {
      await expect(manager.readOutput(task.taskId)).resolves.toContain('after detach\n');
    });

    finish();
    await expect(manager.wait(task.taskId)).resolves.toMatchObject({
      status: 'completed',
    });
  });


  it('keeps task metadata independent when noisy foreground output is capped before detach', async () => {
    const { proc, finish } = pendingProcess();
    const manager = createBackgroundManager().manager;
    const tool = bashTool(
      createFakeKaos({
        execWithEnv: vi.fn().mockResolvedValue(proc),
        osEnv: posixEnv,
      }),
      '/workspace',
      manager,
    );

    const running = executeTool(tool, context({ command: 'yes noisy', timeout: 60 }));
    await vi.waitFor(() => {
      expect(manager.list(false)).toHaveLength(1);
    });
    const task = manager.list(false)[0]!;
    await vi.waitFor(() => {
      expect((proc.stdout as PassThrough).listenerCount('data')).toBeGreaterThanOrEqual(1);
    });

    (proc.stdout as PassThrough).write(
      Array.from({ length: 6000 }, (_, index) => `noisy output line ${String(index)}\n`).join(''),
    );
    manager.detach(task.taskId);
    const result = await running;

    expect(result).toMatchObject({ isError: false });
    expect(typeof result.output).toBe('string');
    const output = result.output as string;
    expect(output).toContain(`task_id: ${task.taskId}`);
    expect(output).toContain('automatic_notification: true');
    expect(output).toContain('foreground_output:');
    expect(output).toContain('noisy output line 0');
    expect(output).toContain('[...truncated]');
    expect(output).toContain('Output is truncated to fit in the message.');
    expect(output.indexOf(`task_id: ${task.taskId}`)).toBeLessThan(
      output.indexOf('foreground_output:'),
    );

    finish();
    await expect(manager.wait(task.taskId)).resolves.toMatchObject({
      status: 'completed',
      detached: true,
    });
  });

  it('does not spawn when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const execWithEnv = vi.fn();
    const tool = bashTool(
      createFakeKaos({ execWithEnv, osEnv: posixEnv }),
      '/workspace',
      createBackgroundManager().manager,
    );

    await expect(executeTool(tool, context({ command: 'echo nope' }, controller.signal))).rejects.toMatchObject({ name: 'AbortError' });
    expect(execWithEnv).not.toHaveBeenCalled();
  });

  it('settles a running native process and its streams before returning an abort result', async () => {
    const kaos = await LocalKaos.create();
    const proc = await kaos.exec(process.execPath, '-e', "require('node:net').createServer().listen(0, '127.0.0.1', () => process.stdout.write('ready\\n'))");
    const ready = once(proc.stdout, 'data');
    const controller = new AbortController();
    const manager = createBackgroundManager().manager;
    const tool = bashTool(
      createFakeKaos({ execWithEnv: async () => proc, osEnv: kaos.osEnv }),
      kaos.getcwd(),
      manager,
    );
    const started = Promise.withResolvers<string>();
    const running = executeTool(tool, {
      ...context({ command: 'node server', timeout: 60 }, controller.signal),
      onForegroundTaskStart: (taskId) => started.resolve(taskId),
    });
    try {
      const taskId = await started.promise;
      await ready;
      expect(proc.stdin.writableEnded).toBe(true);
      expect(proc.resourcesSettled).not.toBe(true);
      expect(manager.getTask(taskId)).toMatchObject({ status: 'running', endedAt: null });
      controller.abort();
      const result = await running;

      expect(result).toMatchObject({ isError: true });
      expect(result.output).toContain('Interrupted by user');
      expect(manager.getTask(taskId)).toMatchObject({ status: 'killed' });
      expect(proc.resourcesSettled).toBe(true);
      expect(proc.stdin.closed).toBe(true);
      expect(proc.stdout.closed).toBe(true);
      expect(proc.stderr.closed).toBe(true);
    } finally {
      controller.abort();
      await proc.kill('SIGKILL');
      await proc.wait();
      await proc.dispose();
      await manager.stopAll('test teardown');
      await running;
    }
  });


  it('registers background commands and returns a task id', async () => {
    const proc = processWithOutput();
    const execWithEnv = vi.fn().mockResolvedValue(proc);
    const manager = createBackgroundManager().manager;
    const tool = bashTool(createFakeKaos({ execWithEnv, osEnv: posixEnv }), '/workspace', manager);

    const result = await executeTool(tool,
      context({ command: 'sleep 10', run_in_background: true, description: 'long running task' }),
    );

    expect(result.output).toMatch(/task_id: bash-[0-9a-z]{8}/);
    expect(result.output).toContain('automatic_notification: true');
    expect(manager.list(false)).toHaveLength(1);
  });

  it('settles an unregistered process before returning a task-capacity rejection', async () => {
    const manager = createBackgroundManager({ maxRunningTasks: 1 }).manager;
    const existing = pendingProcess();
    const existingId = registerProcess(manager, existing.proc, 'sleep 10', 'existing task');
    const rejected = pendingProcess();
    const cleanup = Promise.withResolvers<void>();
    const rejectedProc = {
      ...rejected.proc,
      kill: vi.fn(async () => {}),
      dispose: vi.fn(async () => {
        await cleanup.promise;
        await rejected.proc.dispose();
      }),
    };
    const execWithEnv = vi.fn().mockResolvedValue(rejectedProc);
    const tool = bashTool(createFakeKaos({ execWithEnv, osEnv: posixEnv }), '/workspace', manager);
    const running = executeTool(tool, context({ command: 'sleep 10', run_in_background: true, description: 'second task' }));
    let settled = false;
    void running.then(() => { settled = true; });
    try {
      await vi.waitFor(() => {
        expect(rejectedProc.kill).toHaveBeenCalled();
      });
      expect(rejectedProc.wait).toHaveBeenCalled();
      expect(rejectedProc.dispose).not.toHaveBeenCalled();
      expect(settled).toBe(false);
      rejected.finish(143);
      await vi.waitFor(() => { expect(rejectedProc.dispose).toHaveBeenCalled(); });
      expect(settled).toBe(false);
      cleanup.resolve();
      expect(await running).toMatchObject({
        isError: true,
        output: 'Too many background tasks are already running.',
      });
      expect(rejected.proc.exitCode).not.toBeNull();
      expect(rejectedProc.stdin.closed).toBe(true);
      expect(rejectedProc.stdout.closed).toBe(true);
      expect(rejectedProc.stderr.closed).toBe(true);
      expect(execWithEnv).toHaveBeenCalledOnce();
      expect(manager.list(false)).toHaveLength(1);
    } finally {
      rejected.finish(143);
      cleanup.resolve();
      existing.finish();
      await running;
      await manager.wait(existingId);
    }
  });

  it('rejects one of two concurrent background commands when the task limit is reached', async () => {
    const manager = createBackgroundManager({ maxRunningTasks: 1 }).manager;
    const { proc: firstProc, finish } = pendingProcess();
    const secondProc = pendingProcess().proc;
    const execWithEnv = vi
      .fn()
      .mockResolvedValueOnce(firstProc)
      .mockResolvedValueOnce(secondProc);
    const tool = bashTool(createFakeKaos({ execWithEnv, osEnv: posixEnv }), '/workspace', manager);

    const first = executeTool(tool,
      context({ command: 'sleep 10', run_in_background: true, description: 'first task' }),
    );
    const second = executeTool(tool,
      context({ command: 'sleep 10', run_in_background: true, description: 'second task' }),
    );

    const results = await Promise.all([first, second]);

    expect(execWithEnv).toHaveBeenCalledTimes(2);
    expect(secondProc.wait).toHaveBeenCalled();
    expect(secondProc.dispose).toHaveBeenCalled();
    expect(secondProc.exitCode).not.toBeNull();
    expect(secondProc.stdin.closed).toBe(true);
    expect(secondProc.stdout.closed).toBe(true);
    expect(secondProc.stderr.closed).toBe(true);
    expect(results).toContainEqual(expect.objectContaining({ isError: false }));
    expect(results).toContainEqual(
      expect.objectContaining({
        isError: true,
        output: 'Too many background tasks are already running.',
      }),
    );
    finish();
    await manager.wait(manager.list(false)[0]!.taskId);
  });

  it('uses Git Bash semantics and rejects the concurrent command at the task limit', async () => {
    const manager = createBackgroundManager({ maxRunningTasks: 1 }).manager;
    const { proc: firstProc, finish } = pendingProcess();
    const secondProc = pendingProcess().proc;
    const execWithEnv = vi
      .fn()
      .mockResolvedValueOnce(firstProc)
      .mockResolvedValueOnce(secondProc);
    const tool = bashTool(
      createFakeKaos({ execWithEnv, osEnv: windowsBashEnv }),
      'C:\\Users\\me\\project',
      manager,
    );

    const first = executeTool(tool,
      context({
        command: 'echo ok 2>nul',
        run_in_background: true,
        description: 'first task',
      }),
    );
    const second = executeTool(tool,
      context({
        command: 'echo second',
        run_in_background: true,
        description: 'second task',
      }),
    );

    const results = await Promise.all([first, second]);

    expect(execWithEnv).toHaveBeenCalledTimes(2);
    const [argv, env] = execWithEnv.mock.calls[0]!;
    expect(argv).toEqual([
      'C:\\Program Files\\Git\\bin\\bash.exe',
      '-c',
      "cd '/c/Users/me/project' && echo ok 2>/dev/null",
    ]);
    expect(env).toMatchObject({ SHELL: 'C:\\Program Files\\Git\\bin\\bash.exe' });
    expect(secondProc.wait).toHaveBeenCalled();
    expect(secondProc.dispose).toHaveBeenCalled();
    expect(secondProc.exitCode).not.toBeNull();
    expect(secondProc.stdin.closed).toBe(true);
    expect(secondProc.stdout.closed).toBe(true);
    expect(secondProc.stderr.closed).toBe(true);
    expect(results).toContainEqual(expect.objectContaining({ isError: false }));
    expect(results).toContainEqual(
      expect.objectContaining({
        isError: true,
        output: 'Too many background tasks are already running.',
      }),
    );
    finish();
    await manager.wait(manager.list(false)[0]!.taskId);
  });

  it.each([
    { command: 'pwd', cwd: '/tmp', profile: 'workspace' as const, code: 'PATH_OUTSIDE_WORKSPACE' },
    { command: 'cat /etc/hosts', cwd: '/workspace', profile: 'workspace' as const, code: 'PATH_OUTSIDE_WORKSPACE' },
    { command: 'echo changed > output.txt', cwd: '/workspace', profile: 'read-only' as const, code: 'PATH_READ_ONLY' },
  ])('denies sandbox violations before native process spawning: %j', async ({ command, cwd, profile, code }) => {
    const execWithEnv = vi.fn();
    const tool = bashTool(createFakeKaos({ execWithEnv, osEnv: posixEnv }), '/workspace', createBackgroundManager().manager, {
      workspace: { workspaceDir: '/workspace', additionalDirs: ['/extra'], sandboxProfile: profile },
    });
    const result = await executeTool(tool, context({ command, cwd }));
    expect(result).toMatchObject({ isError: true });
    expect(result.output).toContain(`code=${code}`);
    expect(execWithEnv).not.toHaveBeenCalled();
  });

  it('runs shell file work inside explicitly selected sandbox roots', async () => {
    const execWithEnv = vi.fn().mockResolvedValue(processWithOutput({ stdout: 'allowed\n' }));
    const tool = bashTool(createFakeKaos({ execWithEnv, osEnv: posixEnv }), '/workspace', createBackgroundManager().manager, {
      workspace: { workspaceDir: '/workspace', additionalDirs: ['/extra'], sandboxProfile: 'workspace' },
    });
    expect(await executeTool(tool, context({ command: 'cat ./notes.txt 2>/dev/null', cwd: '/extra' }))).toMatchObject({ isError: false });
    expect(execWithEnv).toHaveBeenCalledWith(['/bin/bash', '-c', "cd '/extra' && cat ./notes.txt 2>/dev/null"], expect.any(Object));
  });

  it('keeps a timeout-requested background process running until wait settles despite a visible exit', async () => {
    vi.useFakeTimers();
    try {
      const { proc, finishWait, markExited } = processWithVisibleExitBeforeWait(0);
      const execWithEnv = vi.fn().mockResolvedValue(proc);
      const manager = createBackgroundManager().manager;
      const tool = bashTool(createFakeKaos({ execWithEnv, osEnv: posixEnv }), '/workspace', manager);

      const result = await executeTool(tool,
        context({
          command: 'sleep 10',
          run_in_background: true,
          description: 'exit before close',
          timeout: 1,
        }),
      );
      expect(typeof result.output).toBe('string');
      if (typeof result.output !== 'string') throw new Error('Expected string tool output.');
      const taskId = result.output.match(/task_id: (bash-[0-9a-z]{8})/)?.[1];
      expect(taskId).toBeDefined();

      markExited();
      await vi.advanceTimersByTimeAsync(1_000);

      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
      expect(manager.getTask(taskId!)).toMatchObject({ status: 'running' });
      expect(proc.dispose).not.toHaveBeenCalled();

      finishWait();
      await vi.runAllTimersAsync();

      expect(manager.getTask(taskId!)?.status).toBe('timed_out');
      expect(proc.dispose).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });


  it('does not timeout-stop a background task when disable_timeout is true', async () => {
    vi.useFakeTimers();
    try {
      const { proc, finish } = pendingProcess();
      const execWithEnv = vi.fn().mockResolvedValue(proc);
      const manager = createBackgroundManager().manager;
      const tool = bashTool(createFakeKaos({ execWithEnv, osEnv: posixEnv }), '/workspace', manager);

      const result = await executeTool(tool,
        context({
          command: 'sleep 999',
          run_in_background: true,
          description: 'no deadline',
          disable_timeout: true,
        }),
      );
      expect(result).toMatchObject({ isError: false });

      await vi.advanceTimersByTimeAsync(600_000 + 10_000);

      expect(proc.kill).not.toHaveBeenCalled();
      finish();
      await expect(manager.wait(manager.list(false)[0]!.taskId)).resolves.toMatchObject({ status: 'completed' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('adds a truncation note when stdout exceeds the cap', async () => {
    const huge = Buffer.alloc(10 * 1024 * 1024 + 1, 'x');
    const tool = bashTool(
      createFakeKaos({
        execWithEnv: vi.fn().mockResolvedValue(processWithOutput({ stdout: huge })),
        osEnv: posixEnv,
      }),
      '/workspace',
    );

    const result = await executeTool(tool, context({ command: 'yes', timeout: 60 }));

    expect(result.output).toContain('[...truncated]');
    expect(result.output).toContain('Output is truncated');
    expect((result as { message?: string }).message).toContain('Output is truncated');
  });

  it('saves full foreground output when the inline result is truncated', async () => {
    const sessionDir = mkdtempSync(join(tmpdir(), 'bash-truncated-'));
    try {
      const fullOutput = `${'short line\n'.repeat(6_000)}tail survives\n`;
      const { manager } = createBackgroundManager({ sessionDir });
      const tool = bashTool(
        createFakeKaos({
          execWithEnv: vi.fn().mockResolvedValue(processWithOutput({ stdout: fullOutput })),
          osEnv: posixEnv,
        }),
        '/workspace',
        manager,
      );

      const result = await executeTool(tool, context({ command: 'flood', timeout: 60 }));
      const output = result.output as string;
      const outputPath = /^output_path: (.+)$/m.exec(output)?.[1];

      expect(output).toContain('[...truncated]');
      expect(output).toContain('task_id: bash-');
      expect(outputPath).toBeTruthy();
      expect(readFileSync(outputPath!, 'utf8')).toBe(fullOutput);
    } finally {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  it('marks the truncated output buffer with a "[...truncated]" sentinel at the cut point', async () => {
    const huge = Buffer.alloc(10 * 1024 * 1024 + 1, 'x');
    const tool = bashTool(
      createFakeKaos({
        execWithEnv: vi.fn().mockResolvedValue(processWithOutput({ stdout: huge })),
        osEnv: posixEnv,
      }),
      '/workspace',
    );

    const result = await executeTool(tool, context({ command: 'yes', timeout: 60 }));

    expect(typeof result.output).toBe('string');
    const output = result.output as string;
    expect(output).toContain('[...truncated]');
  });

  it('truncates output with the sentinel even when the command fails', async () => {
    const huge = Buffer.alloc(10 * 1024 * 1024 + 1, 'E');
    const tool = bashTool(
      createFakeKaos({
        execWithEnv: vi
          .fn()
          .mockResolvedValue(processWithOutput({ stdout: huge, exitCode: 1 })),
        osEnv: posixEnv,
      }),
      '/workspace',
    );

    const result = await executeTool(tool, context({ command: 'fail-and-flood', timeout: 60 }));

    expect(result).toMatchObject({ isError: true });
    expect(typeof result.output).toBe('string');
    const output = result.output as string;
    expect(output).toContain('[...truncated]');
    expect(output).toContain('Output is truncated');
  });

  it('reports a timed-out command with both message and brief lines', async () => {
    vi.useFakeTimers();
    try {
      let resolveWait: (code: number) => void = () => {};
      const waitPromise = new Promise<number>((resolve) => {
        resolveWait = resolve;
      });
      const proc = processWithOutput({
        wait: async () => waitPromise,
        kill: async () => {
          resolveWait(143);
        },
      });
      const tool = bashTool(
        createFakeKaos({ execWithEnv: vi.fn().mockResolvedValue(proc), osEnv: posixEnv }),
        '/workspace',
      );

      const running = executeTool(tool, context({ command: 'sleep 2', timeout: 1 }));
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(250);
      const result = await running;

      expect(result).toMatchObject({
        isError: true,
        brief: 'Killed by timeout (1s)',
      });
      expect(result.output).toContain('Command killed by timeout (1s)');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports timeout instead of premature close when cleanup destroys open output streams', async () => {
    vi.useFakeTimers();
    try {
      const proc = processWithOpenStreamsThatExitOnKill();
      const tool = bashTool(
        createFakeKaos({ execWithEnv: vi.fn().mockResolvedValue(proc), osEnv: posixEnv }),
        '/workspace',
      );

      const running = executeTool(tool, context({ command: 'sleep 2', timeout: 1 }));
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(250);
      const result = await running;

      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
      expect(result).toMatchObject({
        isError: true,
        brief: 'Killed by timeout (1s)',
      });
      expect(result.output).toContain('Command killed by timeout (1s)');
      expect(result.output).not.toContain('Premature close');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a stream read error as a tool error even when the process exits with code 0', async () => {
    const proc = processWithStreamError({
      stdoutError: new Error('SSH channel read failed'),
      exitCode: 0,
    });
    const tool = bashTool(
      createFakeKaos({ execWithEnv: vi.fn().mockResolvedValue(proc), osEnv: posixEnv }),
      '/workspace',
    );

    const result = await executeTool(tool, context({ command: 'remote-cmd', timeout: 60 }));

    expect(result).toMatchObject({ isError: true });
    expect(result.output).toContain('SSH channel read failed');
  });

  it('rejects empty-string commands at the schema layer', () => {
    expect(BashInputSchema.safeParse({ command: '' }).success).toBe(false);
  });

  it('does not inject GIT_SSH_COMMAND into the spawn environment', async () => {
    const previous = process.env['GIT_SSH_COMMAND'];
    delete process.env['GIT_SSH_COMMAND'];
    try {
      const execWithEnv = vi.fn().mockResolvedValue(processWithOutput({ stdout: 'ok\n' }));
      const tool = bashTool(createFakeKaos({ execWithEnv, osEnv: posixEnv }), '/workspace');

      await executeTool(tool, context({ command: 'true', timeout: 60 }));

      const env = execWithEnv.mock.calls[0]?.[1] as Record<string, string>;
      expect(Object.prototype.hasOwnProperty.call(env, 'GIT_SSH_COMMAND')).toBe(false);
    } finally {
      if (previous !== undefined) process.env['GIT_SSH_COMMAND'] = previous;
    }
  });


  it('rejects background command without description (description-required guard)', async () => {
    const manager = createBackgroundManager().manager;
    const execWithEnv = vi.fn().mockResolvedValue(processWithOutput());
    const tool = bashTool(createFakeKaos({ execWithEnv, osEnv: posixEnv }), '/workspace', manager);

    const result = await executeTool(
      tool,
      context({ command: 'sleep 1', run_in_background: true }),
    );

    expect(result).toMatchObject({ isError: true });
    expect(result.output).toContain('description is required');
    expect(execWithEnv).not.toHaveBeenCalled();
  });

  it('rewrites nul-redirect on Windows so the spawned argv has /dev/null', async () => {
    const execWithEnv = vi.fn().mockResolvedValue(processWithOutput({ stdout: '' }));
    const tool = bashTool(
      createFakeKaos({ execWithEnv, osEnv: windowsBashEnv }),
      'C:\\Users\\me\\project',
    );

    await executeTool(tool, context({ command: 'ls 2>nul', timeout: 60 }));

    const argv = execWithEnv.mock.calls[0]?.[0] as readonly string[];
    expect(argv[2]).toBe("cd '/c/Users/me/project' && ls 2>/dev/null");
  });

  it('passes nul-redirect through unchanged on Linux so the argv keeps the literal file target', async () => {
    const execWithEnv = vi.fn().mockResolvedValue(processWithOutput({ stdout: '' }));
    const tool = bashTool(createFakeKaos({ execWithEnv, osEnv: posixEnv }), '/workspace');

    await executeTool(tool, context({ command: 'ls 2>nul', timeout: 60 }));

    const argv = execWithEnv.mock.calls[0]?.[0] as readonly string[];
    expect(argv[2]).toBe("cd '/workspace' && ls 2>nul");
  });

  it.each([
    'cat src/index.ts',
    'rg "foo" packages',
    "find . -name '*.ts'",
    'echo hello > out.txt',
    "sed -i 's/foo/bar/g' src/index.ts",
    "python -c \"open('out.txt','w').write('x')\"",
    'cat > out.txt <<EOF\nhello\nEOF',
  ])('executes file and search work through Bash: %s', async (command) => {
    const execWithEnv = vi.fn().mockResolvedValue(processWithOutput({ stdout: 'ok\n' }));
    const tool = bashTool(createFakeKaos({ execWithEnv, osEnv: posixEnv }), '/workspace');
    const result = await executeTool(tool, context({ command, timeout: 60 }));
    expect(result).toMatchObject({ isError: false });
    expect(execWithEnv.mock.calls[0]?.[0]).toContain(`cd '/workspace' && ${command}`);
  });

  it('rejects sensitive path access via Bash with hard deny', async () => {
    const execWithEnv = vi.fn();
    const tool = bashTool(createFakeKaos({ execWithEnv, osEnv: posixEnv }), '/workspace');

    const env = await executeTool(tool, context({ command: 'cat .env', timeout: 60 }));
    expect(env).toMatchObject({ isError: true });
    expect(String(env.output)).toMatch(/sensitive/i);
    expect(execWithEnv).not.toHaveBeenCalled();

  });


  it('allows real process work and pipelines', async () => {
    const execWithEnv = vi.fn().mockResolvedValue(processWithOutput({ stdout: 'ok\n' }));
    const tool = bashTool(createFakeKaos({ execWithEnv, osEnv: posixEnv }), '/workspace');

    await executeTool(tool, context({ command: 'pnpm test', timeout: 60 }));
    await executeTool(tool, context({ command: 'cat file | head', timeout: 60 }));
    expect(execWithEnv).toHaveBeenCalledTimes(2);
  });


});


