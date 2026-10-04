import { PassThrough, Readable } from 'node:stream';

import type { KaosProcess } from '@superliora/kaos';
import { describe, expect, it, vi } from 'vitest';

import { isSessionWorktreeOwned } from '../../src/session/worktree';
import { BashTool } from '../../src/tools/builtin/shell/bash';
import { createBackgroundManager } from '../agent/background/helpers';
import { executeTool } from './fixtures/execute-tool';
import { createFakeKaos, toolContentString } from './fixtures/fake-kaos';

function processFixture(wait = async (): Promise<number> => 0): KaosProcess {
  const stdin = new PassThrough();
  const stdout = Readable.from(['owned output']);
  const stderr = Readable.from([]);
  return {
    stdin, stdout, stderr, pid: 123, exitCode: null, wait,
    kill: vi.fn(async () => {}),
    dispose: vi.fn(async () => { stdin.destroy(); stdout.destroy(); stderr.destroy(); }),
  };
}

function fixture(options: {
  ready?: () => Promise<void>;
  proc?: KaosProcess;
  maxRunningTasks?: number;
  admission?: 'before-start' | 'after-start';
  workspace?: boolean;
} = {}) {
  const { manager } = createBackgroundManager({ maxRunningTasks: options.maxRunningTasks });
  const spawn = vi.fn(async () => options.proc ?? processFixture());
  const ready = vi.fn(options.ready ?? (async () => {}));
  const kaos = createFakeKaos({ execWithEnv: spawn });
  const tool = new BashTool(kaos, '/workspace', manager, {
    backgroundAdmission: options.admission ?? 'before-start',
    ensureSandboxReady: ready,
    ...(options.workspace ? { workspace: { workspaceDir: '/workspace', additionalDirs: [], sandboxProfile: 'workspace' as const } } : {}),
  });
  const inference = new AbortController();
  const run = (command = 'echo hello', cwd?: string) => executeTool(tool, {
    args: { command, run_in_background: true, description: 'owned execution', ...(cwd === undefined ? {} : { cwd }) },
    signal: inference.signal,
    turnId: 'turn-test', toolCallId: 'call-test',
  });
  return { manager, spawn, ready, inference, run };
}

function taskId(output: string): string {
  const id = /task_id: (\S+)/u.exec(output)?.[1];
  if (id === undefined) throw new Error(`No task ID: ${output}`);
  return id;
}

const nextTurn = () => new Promise<void>((resolve) => { setImmediate(resolve); });

describe('Bash accepted-before-start admission', () => {
  it('returns admission before readiness and spawn; inference abort does not own execution', async () => {
    const gate = Promise.withResolvers<void>();
    const f = fixture({ ready: () => gate.promise });
    const result = await f.run();
    const id = taskId(toolContentString(result));
    expect(result.isError).toBe(false);
    expect(f.ready).not.toHaveBeenCalled();
    expect(f.spawn).not.toHaveBeenCalled();
    expect(isSessionWorktreeOwned('/workspace', '/workspace')).toBe(true);
    expect(f.manager.getTask(id)).toMatchObject({ status: 'running', executionPhase: 'accepted', resourcesSettled: false });
    f.inference.abort('discard inference');
    await nextTurn();
    expect(f.ready).toHaveBeenCalledOnce();
    expect(f.manager.getTask(id)).toMatchObject({ executionPhase: 'preparing' });
    expect(await f.manager.wait(id, 0)).toMatchObject({ status: 'running', resourcesSettled: false });
    expect(f.manager.list(true, 1)).toHaveLength(1);
    gate.resolve();
    expect(await f.manager.wait(id)).toMatchObject({ status: 'completed', resourcesSettled: true });
    expect(await f.manager.readOutput(id)).toContain('owned output');
    expect(f.spawn).toHaveBeenCalledOnce();
    expect(isSessionWorktreeOwned('/workspace', '/workspace')).toBe(false);
  });

  it('fails closed if sandbox readiness fails after acceptance', async () => {
    const f = fixture({ ready: async () => { throw new Error('Sandbox unavailable'); } });
    const id = taskId(toolContentString(await f.run()));
    expect(await f.manager.wait(id)).toMatchObject({ status: 'failed', stopReason: 'Sandbox unavailable', resourcesSettled: true });
    expect(f.spawn).not.toHaveBeenCalled();
  });

  it('keeps cancellation nonterminal until preparation actually joins and never spawns afterward', async () => {
    const gate = Promise.withResolvers<void>();
    const f = fixture({ ready: () => gate.promise });
    const id = taskId(toolContentString(await f.run()));
    await nextTurn();
    let joined = false;
    const stopped = f.manager.stop(id).then((info) => { joined = true; return info; });
    await nextTurn();
    expect(joined).toBe(false);
    expect(f.manager.getTask(id)).toMatchObject({ status: 'running', resourcesSettled: false });
    gate.resolve();
    expect(await stopped).toMatchObject({ status: 'killed', resourcesSettled: true });
    expect(f.spawn).not.toHaveBeenCalled();
  });

  it('adopts a process returned after cancellation and joins its resources', async () => {
    const spawned = Promise.withResolvers<KaosProcess>();
    const exited = Promise.withResolvers<number>();
    const proc = processFixture(() => exited.promise);
    const f = fixture();
    f.spawn.mockImplementationOnce(() => spawned.promise);
    const id = taskId(toolContentString(await f.run()));
    await nextTurn();
    const stopped = f.manager.stop(id);
    spawned.resolve(proc);
    await nextTurn();
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(f.manager.getTask(id)).toMatchObject({ status: 'running', resourcesSettled: false });
    exited.resolve(0);
    expect(await stopped).toMatchObject({ status: 'killed', resourcesSettled: true });
    expect(proc.dispose).toHaveBeenCalledOnce();
  });

  it('can cancel queued admission before readiness starts', async () => {
    const f = fixture();
    const id = taskId(toolContentString(await f.run()));
    expect(await f.manager.stop(id)).toMatchObject({ status: 'killed', resourcesSettled: true });
    expect(f.ready).not.toHaveBeenCalled();
    expect(f.spawn).not.toHaveBeenCalled();
    expect(isSessionWorktreeOwned('/workspace', '/workspace')).toBe(false);
  });

  it('checks admission capacity before preparation or spawn', async () => {
    const f = fixture({ maxRunningTasks: 0 });
    expect(await f.run()).toMatchObject({ isError: true, output: 'Too many background tasks are already running.' });
    await nextTurn();
    expect(f.ready).not.toHaveBeenCalled();
    expect(f.spawn).not.toHaveBeenCalled();
    expect(f.manager.list()).toEqual([]);
  });

  it('guards the effective absolute cwd when the caller passes a relative one', async () => {
    const gate = Promise.withResolvers<void>();
    const f = fixture({ ready: () => gate.promise });
    const id = taskId(toolContentString(await f.run('echo nested', 'nested/worktree')));
    expect(isSessionWorktreeOwned('/workspace/nested/worktree', '/workspace')).toBe(true);
    expect(isSessionWorktreeOwned('/workspace/other', '/workspace')).toBe(false);
    gate.resolve();
    expect(await f.manager.wait(id)).toMatchObject({ status: 'completed', resourcesSettled: true });
    expect(isSessionWorktreeOwned('/workspace/nested/worktree', '/workspace')).toBe(false);
  });

  it('preserves workspace gates for deferred execution', async () => {
    const f = fixture({ workspace: true });
    const id = taskId(toolContentString(await f.run('cat /outside/file')));
    expect(await f.manager.wait(id)).toMatchObject({ status: 'failed', resourcesSettled: true });
    expect(f.ready).toHaveBeenCalledOnce();
    expect(f.spawn).not.toHaveBeenCalled();
  });

  it('preserves after-start policy for other roles', async () => {
    const gate = Promise.withResolvers<void>();
    const f = fixture({ admission: 'after-start', ready: () => gate.promise });
    let returned = false;
    const result = f.run().then((value) => { returned = true; return value; });
    await nextTurn();
    expect(f.ready).toHaveBeenCalledOnce();
    expect(returned).toBe(false);
    gate.resolve();
    const id = taskId(toolContentString(await result));
    expect(f.spawn).toHaveBeenCalledOnce();
    expect(await f.manager.wait(id)).toMatchObject({ status: 'completed' });
  });
});
