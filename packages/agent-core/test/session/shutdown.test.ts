import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { Readable, Writable } from 'node:stream';
import type { KaosProcess } from '@superliora/kaos';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentOptions } from '../../src/agent';
import { ProcessBackgroundTask } from '../../src/agent/background';
import * as profile from '../../src/profile';
import { getDefaultSwarmFileLeaseRegistry, resetDefaultSwarmFileLeaseRegistry } from '../../src/fleet/swarm-file-lease';
import type { SDKSessionRPC } from '../../src/rpc';
import { Session } from '../../src/session';
import { ProviderManager } from '../../src/session/provider/provider-manager';
import { isSessionWorktreeOwned } from '../../src/session/worktree';
import { testKaos } from '../fixtures/test-kaos';

const tempDirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  resetDefaultSwarmFileLeaseRegistry();
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'liora-session-shutdown-'));
  tempDirs.push(root);
  const workDir = join(root, 'work');
  const homedir = join(root, 'session');
  await mkdir(workDir);
  await mkdir(homedir);
  const rpc: SDKSessionRPC = {
    emitEvent: vi.fn(async () => {}),
    requestApproval: vi.fn(async () => ({ decision: 'cancelled' as const })),
    requestQuestion: vi.fn(async () => null),
    requestCredential: vi.fn(async () => null),
  };
  const session = new Session({
    kaos: testKaos.withCwd(workDir), homedir, rpc,
    providerManager: new ProviderManager({ config: {
      providers: { test: { type: 'kimi', apiKey: 'test-key' } },
      models: { 'mock-model': { provider: 'test', model: 'mock-model', maxContextSize: 100000 } },
    } }),
  });
  return session;
}

function pendingProcess() {
  const exited = Promise.withResolvers<number>();
  const killed = Promise.withResolvers<void>();
  const disposed = Promise.withResolvers<void>();
  let exitCode: number | null = null;
  const kill = vi.fn<KaosProcess['kill']>(async () => { killed.resolve(); });
  const dispose = vi.fn<KaosProcess['dispose']>(() => disposed.promise);
  const proc: KaosProcess = {
    stdin: new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
    stdout: Readable.from([]), stderr: Readable.from([]), pid: 54321,
    get exitCode() { return exitCode; },
    wait: () => exited.promise, kill, dispose,
  };
  return {
    proc, kill, dispose, killed: killed.promise,
    exit(code: number) { exitCode = code; exited.resolve(code); },
    finishDisposal: disposed.resolve,
    failDisposal: disposed.reject,
  };
}

describe('Session shutdown ownership', () => {
  it('shares close completion, closes admissions immediately, and joins process exit and disposal', async () => {
    const session = await fixture();
    const agent = await session.createMain();
    const process = pendingProcess();
    const steer = vi.spyOn(agent.turn, 'steer');
    const taskId = agent.background.registerTask(new ProcessBackgroundTask(process.proc, 'sleep 60', 'owned process', agent.kaos.getcwd()));
    let closed = false;
    const completion = session.close();
    void completion.then(() => { closed = true; });
    expect(session.close()).toBe(completion);
    await expect(session.createAgent({ type: 'sub' })).rejects.toThrow('closing');
    expect(() => session.startConversationLoop({ prompt: 'another turn' })).toThrow('closing');
    await process.killed;
    expect(process.kill).toHaveBeenCalledWith('SIGTERM');
    expect(closed).toBe(false);
    process.exit(143);
    await vi.waitFor(() => expect(process.dispose).toHaveBeenCalled());
    expect(closed).toBe(false);
    process.finishDisposal();
    await completion;
    expect(agent.background.getTask(taskId)?.status).toBe('killed');
    expect(steer).not.toHaveBeenCalled();
  });

  it('waits for an aborted provider to settle before releasing the foreground turn', async () => {
    const session = await fixture();
    const started = Promise.withResolvers<void>();
    const aborted = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const generate: NonNullable<AgentOptions['generate']> = async (
      _chat, _systemPrompt, _tools, _history, _callbacks, options,
    ) => {
      const signal = options?.signal;
      if (signal === undefined) throw new Error('Expected provider cancellation signal');
      signal.addEventListener('abort', () => aborted.resolve(), { once: true });
      started.resolve();
      await release.promise;
      throw signal.reason;
    };
    const { agent } = await session.createAgent({ type: 'main', generate });
    agent.config.update({ modelAlias: 'mock-model', thinkingLevel: 'off' });
    expect(agent.turn.prompt([{ type: 'text', text: 'work until cancelled' }])).not.toBeNull();
    await started.promise;
    let closed = false;
    const completion = session.close();
    void completion.then(() => { closed = true; });
    await aborted.promise;
    expect(closed).toBe(false);
    expect(agent.turn.hasActiveTurn).toBe(true);
    release.resolve();
    await completion;
    expect(agent.turn.hasActiveTurn).toBe(false);
  });

  it('joins a worker still preparing its context before releasing its ownership lease', async () => {
    const session = await fixture();
    const main = await session.createMain();
    main.config.update({ modelAlias: 'mock-model', thinkingLevel: 'off' });
    const context = await profile.prepareSystemPromptContext(session.systemContextKaos(main.config.cwd));
    const preparing = Promise.withResolvers<void>();
    const release = Promise.withResolvers<typeof context>();
    vi.spyOn(profile, 'prepareSystemPromptContext').mockImplementationOnce(() => {
      preparing.resolve();
      return release.promise;
    });
    const path = join(main.config.cwd, 'owned.ts');
    const host = session.getSubagentHost('main');
    const worker = await host.spawn({
      parentToolCallId: 'close-pending-preparation', prompt: 'work', description: 'owned worker',
      runInBackground: true, signal: new AbortController().signal, ownership: [path],
    });
    const failed = worker.completion.catch((error: unknown) => error);
    await preparing.promise;
    let closed = false;
    const closing = session.close();
    void closing.then(() => { closed = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(closed).toBe(false);
    expect(getDefaultSwarmFileLeaseRegistry().holder(path)?.ownerId).toBe(worker.agentId);
    release.resolve(context);
    await closing;
    expect(await failed).toBeInstanceOf(Error);
    expect(host.listActive()).toEqual([]);
    expect(getDefaultSwarmFileLeaseRegistry().holder(path)).toBeUndefined();
  });

  it('rejects close without relinquishing a process whose disposal failed', async () => {
    const session = await fixture();
    const agent = await session.createMain();
    const process = pendingProcess();
    const taskId = agent.background.registerTask(new ProcessBackgroundTask(process.proc, 'sleep 60', 'failed disposal', agent.kaos.getcwd()));
    const cwd = agent.kaos.getcwd();
    await vi.waitFor(() => expect(isSessionWorktreeOwned(cwd, cwd)).toBe(true));
    const closing = session.close();
    const failed = closing.catch((error: unknown) => error);
    await process.killed;
    process.exit(143);
    await vi.waitFor(() => expect(process.dispose).toHaveBeenCalled());
    process.failDisposal(new Error('Process disposal failed'));
    expect(await failed).toBeInstanceOf(AggregateError);
    expect(session.close()).toBe(closing);
    expect(agent.background.list(true)).toContainEqual(expect.objectContaining({ taskId }));
    await expect(session.createAgent({ type: 'sub' })).rejects.toThrow('closing');
    expect(isSessionWorktreeOwned(cwd, cwd)).toBe(true);
    process.dispose.mockResolvedValueOnce(undefined);
    await agent.background.stop(taskId, 'retry physical cleanup');
    expect(isSessionWorktreeOwned(cwd, cwd)).toBe(false);
  });

  it('keeps a process captured nested cwd owned after agent movement until disposal settles', async () => {
    const session = await fixture();
    const agent = await session.createMain();
    const repoRoot = agent.kaos.getcwd();
    const worktree = join(repoRoot, 'worker');
    const cwd = join(worktree, 'nested');
    const moved = join(repoRoot, 'another-worker');
    await mkdir(cwd, { recursive: true });
    await mkdir(moved);
    agent.setKaos(testKaos.withCwd(cwd));
    const process = pendingProcess();
    agent.background.registerTask(new ProcessBackgroundTask(process.proc, 'sleep 60', 'captured worker process', cwd));
    await vi.waitFor(() => expect(isSessionWorktreeOwned(worktree, repoRoot)).toBe(true));
    agent.setKaos(testKaos.withCwd(moved));
    expect(isSessionWorktreeOwned(worktree, repoRoot)).toBe(true);
    expect(isSessionWorktreeOwned(moved, repoRoot)).toBe(false);
    const closing = session.close();
    await process.killed;
    process.exit(143);
    await vi.waitFor(() => expect(process.dispose).toHaveBeenCalled());
    expect(isSessionWorktreeOwned(worktree, repoRoot)).toBe(true);
    process.finishDisposal();
    await closing;
    expect(isSessionWorktreeOwned(worktree, repoRoot)).toBe(false);
  });
});
