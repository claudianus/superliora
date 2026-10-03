import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { LocalKaos, type KaosProcess } from '@superliora/kaos';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { collectGitContext, runGit as queryGit } from '../../src/session/git-context';
import { NativeProcessCleanupError, runGit } from '../../src/session/job/git';
import { createFakeKaos } from '../tools/fixtures/fake-kaos';

const tempDirs: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function localFixture() {
  const cwd = await mkdtemp(join(tmpdir(), 'liora-native-git-'));
  tempDirs.push(cwd);
  const kaos = await LocalKaos.create();
  const init = await runGit(kaos, cwd, ['init', '--initial-branch=main']);
  expect(init.ok, init.stderr).toBe(true);
  return { cwd, kaos };
}

// This fixture models transport faults that a local process cannot reliably
// reproduce: a lost exit acknowledgement and a failing resource disposer.
function uncertainProcess() {
  const exited = deferred<number>();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let exitCode: number | null = null;
  let exitedPhysically = false;
  let cleanupHeld = false;
  let waitFailure: Error | undefined;
  let disposeFailure: Error | undefined;
  let released = false;
  const events: string[] = [];
  const proc: KaosProcess = {
    stdin: new PassThrough(), stdout, stderr, pid: 42,
    get exitCode() { return exitCode; },
    get resourcesSettled() { return released; },
    wait: async () => {
      events.push('wait');
      if (waitFailure !== undefined) throw waitFailure;
      return exited.promise;
    },
    kill: async () => { events.push('kill'); },
    dispose: async () => {
      events.push('dispose');
      if (disposeFailure !== undefined) throw disposeFailure;
      released = exitedPhysically && !cleanupHeld && waitFailure === undefined;
    },
  };
  const exec = vi.fn(async () => proc);
  return {
    kaos: createFakeKaos({ exec }), proc, exec, events, stdout, stderr,
    failWait(error?: Error) { waitFailure = error; },
    failDispose(error?: Error) { disposeFailure = error; },
    holdCleanup(held: boolean) { cleanupHeld = held; },
    // A transport may confirm signal exit while losing its numeric metadata.
    exit(code: number | null) { exitCode = code; exitedPhysically = true; exited.resolve(code as number); },
    endStreams() { stdout.end(); stderr.end(); },
  };
}

async function cleanupError(promise: Promise<unknown>): Promise<NativeProcessCleanupError> {
  const error = await promise.catch((error: unknown) => error);
  expect(error).toBeInstanceOf(NativeProcessCleanupError);
  return error as NativeProcessCleanupError;
}

async function turn() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('native Git process ownership', () => {
  it('does not impose a five-second query deadline or replay the query', async () => {
    const { cwd, kaos: local } = await localFixture();
    const release = join(cwd, 'release');
    const script = join(cwd, 'hold.cjs');
    await writeFile(script, `const fs = require('node:fs');
const watcher = fs.watch(${JSON.stringify(cwd)}, () => {
  if (fs.existsSync(${JSON.stringify(release)})) {
    watcher.close(); process.stdout.write('finished\\n');
  }
});
process.stdout.write('ready\\n');\n`);
    const started = deferred<KaosProcess>();
    const ready = deferred<void>();
    let kills = 0;
    let disposed = false;
    let launches = 0;
    const kaos = createFakeKaos({ exec: async (...args: string[]) => {
      launches += 1;
      const proc = await local.exec(...args);
      proc.stdout.once('data', () => ready.resolve());
      const kill = proc.kill.bind(proc);
      const dispose = proc.dispose.bind(proc);
      proc.kill = async (signal) => { kills += 1; await kill(signal); };
      proc.dispose = async () => { await dispose(); disposed = true; };
      started.resolve(proc);
      return proc;
    } });
    let finished = false;
    vi.useFakeTimers();
    const pending = queryGit(kaos, cwd, ['-c', `alias.hold=!node "${script.replaceAll('\\', '/')}"`, 'hold']);
    void pending.then(() => { finished = true; }, () => { finished = true; });
    const proc = await started.promise;
    try {
      await ready.promise;
      await vi.advanceTimersByTimeAsync(6_000);
      expect(finished).toBe(false);
      expect(kills).toBe(0);
      expect(launches).toBe(1);
      vi.useRealTimers();
      await writeFile(release, 'finish');
      expect(await pending).toMatchObject({ ok: true, stdout: expect.stringContaining('finished') });
      expect(disposed).toBe(true);
      expect(launches).toBe(1);
    } finally {
      vi.useRealTimers();
      if (!finished) await proc.kill('SIGKILL');
      await pending.catch(() => {});
    }
  });

  it('aborts the already-running local Git process, joining exit and disposal without replay', async () => {
    const { cwd, kaos: local } = await localFixture();
    const script = join(cwd, 'hold.cjs');
    await writeFile(script, `require('node:fs').watch(${JSON.stringify(cwd)}, () => {}); process.stdout.write('ready\\n');\n`);
    const ready = deferred<void>();
    const events: string[] = [];
    let launches = 0;
    const kaos = createFakeKaos({ exec: async (...args: string[]) => {
      launches += 1;
      const proc = await local.exec(...args);
      proc.stdout.once('data', () => ready.resolve());
      const kill = proc.kill.bind(proc);
      const wait = proc.wait.bind(proc);
      const dispose = proc.dispose.bind(proc);
      proc.kill = async (signal) => { events.push('kill'); await kill(signal); };
      proc.wait = async () => { const code = await wait(); events.push('exit'); return code; };
      proc.dispose = async () => { await dispose(); events.push('disposed'); };
      return proc;
    } });
    const controller = new AbortController();
    const pending = runGit(kaos, cwd, ['-c', `alias.hold=!node "${script.replaceAll('\\', '/')}"`, 'hold'], 0, controller.signal);
    await ready.promise;
    controller.abort();
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.exitCode).not.toBe(0);
    expect(events).toContain('kill');
    expect(events.indexOf('exit')).toBeLessThan(events.indexOf('disposed'));
    expect(events.at(-1)).toBe('disposed');
    expect(launches).toBe(1);
  });

  it('reports capped captured output rather than inventing a full stdout', async () => {
    const { cwd, kaos } = await localFixture();
    const cap = 10 * 1024 * 1024;
    const blob = 'a'.repeat(cap) + 'UNCAPTURED-TAIL';
    await writeFile(join(cwd, 'large.txt'), blob);
    const hash = await runGit(kaos, cwd, ['hash-object', '-w', 'large.txt']);
    expect(hash.ok, hash.stderr).toBe(true);
    const result = await runGit(kaos, cwd, ['cat-file', 'blob', hash.stdout.trim()]);
    expect(result).toMatchObject({ ok: true, exitCode: 0, outputTruncated: true });
    expect(result.stdout).toBe(blob.slice(0, cap));
    expect(result.stdout).not.toContain('UNCAPTURED-TAIL');
    await expect(queryGit(kaos, cwd, ['cat-file', 'blob', hash.stdout.trim()])).rejects.toThrow(/truncated/i);
    expect((await readFile(join(cwd, 'large.txt'), 'utf8')).length).toBeGreaterThan(result.stdout.length);
  });

  it('reports stderr truncation while retaining the actual nonzero Git result', async () => {
    const { cwd, kaos } = await localFixture();
    const cap = 10 * 1024 * 1024;
    const script = join(cwd, 'diagnostic.cjs');
    await writeFile(script, `const fs = require('node:fs');
fs.writeSync(1, 'captured stdout\\n');
fs.writeSync(2, 'e'.repeat(${cap}) + 'UNCAPTURED-ERROR-TAIL');
process.exitCode = 19;\n`);
    const args = ['-c', `alias.diagnostic=!node "${script.replaceAll('\\', '/')}"`, 'diagnostic'];
    const result = await runGit(kaos, cwd, args);
    expect(result).toMatchObject({ ok: false, exitCode: 19, outputTruncated: true });
    expect(result.stdout).toBe('captured stdout\n');
    expect(result.stderr).toBe('e'.repeat(cap));
    expect(result.stderr).not.toContain('UNCAPTURED-ERROR-TAIL');
    await expect(queryGit(kaos, cwd, args)).rejects.toThrow(/truncated/i);
  });

  it('keeps a lost exit acknowledgement observable until explicit same-process cleanup', async () => {
    const fixture = uncertainProcess();
    const lostExit = new Error('transport lost exit acknowledgement');
    fixture.failWait(lostExit);
    fixture.endStreams();
    const error = await cleanupError(runGit(fixture.kaos, '/repo', ['status'], 0));
    expect(error.cause).toBe(lostExit);
    expect(error.resourcesSettled).toBe(false);
    fixture.failWait();
    fixture.exit(137);
    await error.settleResources();
    expect(error.resourcesSettled).toBe(true);
    expect(fixture.exec).toHaveBeenCalledTimes(1);
    expect(fixture.events.filter((event) => event === 'wait')).toHaveLength(2);
  });

  it('keeps failed disposal observable after confirmed exit and retries only cleanup', async () => {
    const fixture = uncertainProcess();
    const disposeFailure = new Error('remote resource disposal failed');
    fixture.failDispose(disposeFailure);
    fixture.exit(0);
    fixture.endStreams();
    const error = await cleanupError(runGit(fixture.kaos, '/repo', ['status'], 0));
    expect(error.cause).toBe(disposeFailure);
    expect(error.resourcesSettled).toBe(false);
    await expect(error.settleResources()).rejects.toMatchObject({ errors: expect.arrayContaining([disposeFailure, error]) });
    expect(error.resourcesSettled).toBe(false);
    fixture.failDispose();
    await error.settleResources();
    expect(error.resourcesSettled).toBe(true);
    expect(fixture.exec).toHaveBeenCalledTimes(1);
    expect(fixture.events.filter((event) => event === 'wait')).toHaveLength(1);
  });

  it('does not override explicit unsettled resources with a fulfilled exit and disposer', async () => {
    const fixture = uncertainProcess();
    fixture.holdCleanup(true);
    fixture.exit(0);
    fixture.endStreams();
    const error = await cleanupError(runGit(fixture.kaos, '/repo', ['status'], 0));
    expect(error.resourcesSettled).toBe(false);
    await expect(error.settleResources()).rejects.toBeInstanceOf(Error);
    expect(error.resourcesSettled).toBe(false);
    fixture.holdCleanup(false);
    await error.settleResources();
    expect(error.resourcesSettled).toBe(true);
    expect(fixture.exec).toHaveBeenCalledTimes(1);
  });

  it('joins stderr and physical exit before surfacing a stdout failure', async () => {
    const fixture = uncertainProcess();
    const failure = new Error('stdout transport failed');
    let finished = false;
    const pending = runGit(fixture.kaos, '/repo', ['status'], 0);
    const observed = pending.catch((error: unknown) => { finished = true; return error; });
    await turn();
    fixture.stdout.destroy(failure);
    await turn();
    expect(finished).toBe(false);
    expect(fixture.events).not.toContain('dispose');
    fixture.exit(1);
    await turn();
    expect(finished).toBe(false);
    fixture.stderr.end('last diagnostic');
    expect(await observed).toBe(failure);
    expect(fixture.events.at(-1)).toBe('dispose');
    expect(fixture.proc.resourcesSettled).toBe(true);
  });

  it('does not turn a signal-confirmed exit without numeric status into exit zero', async () => {
    const fixture = uncertainProcess();
    const controller = new AbortController();
    fixture.proc.kill = async () => {
      fixture.events.push('kill');
      fixture.exit(null);
      fixture.endStreams();
    };
    const pending = runGit(fixture.kaos, '/repo', ['status'], 0, controller.signal);
    await turn();
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, exitCode: null });
    expect(fixture.events).toContain('kill');
    expect(fixture.events.at(-1)).toBe('dispose');
    expect(fixture.exec).toHaveBeenCalledTimes(1);
  });

  it('joins all parallel context probes before exposing one uncertain cleanup', async () => {
    const failed = uncertainProcess();
    const peers = Array.from({ length: 3 }, () => uncertainProcess());
    const initial = uncertainProcess();
    initial.stdout.end('true\n'); initial.stderr.end(); initial.exit(0);
    failed.failDispose(new Error('remote cleanup not confirmed'));
    failed.endStreams(); failed.exit(0);
    let count = 0;
    const kaos = createFakeKaos({ exec: async () => {
      const proc = [initial, failed, ...peers][count++]?.proc;
      if (proc === undefined) throw new Error('unexpected command replay');
      return proc;
    } });
    let finished = false;
    const observed = collectGitContext(kaos, '/repo').catch((error: unknown) => { finished = true; return error; });
    await turn();
    expect(count).toBe(5);
    expect(finished).toBe(false);
    for (const peer of peers) { peer.endStreams(); peer.exit(0); }
    const error = await observed;
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toHaveLength(1);
    expect((error as AggregateError).errors[0]).toBeInstanceOf(NativeProcessCleanupError);
    expect(peers.every((peer) => peer.proc.resourcesSettled === true)).toBe(true);
    const cleanup = (error as AggregateError).errors[0] as NativeProcessCleanupError;
    expect(cleanup.resourcesSettled).toBe(false);
    failed.failDispose();
    await cleanup.settleResources();
    expect(cleanup.resourcesSettled).toBe(true);
    expect(count).toBe(5);
  });
});
