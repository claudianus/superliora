import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Emitter } from '../../src/base/common/event';
import type { Session } from '@superliora/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  FsPathEscapesError,
  SessionNotFoundError,
  TerminalNotFoundError,
  TerminalService,
  type ISessionService,
  type TerminalBackend,
  type TerminalFrame,
  type TerminalProcess,
  type TerminalSpawnOptions,
} from '../../src/services';
import { isSessionWorktreeOwned } from '../../src/session/worktree';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'kimi-terminal-service-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

class FakeTerminalProcess implements TerminalProcess {
  readonly writes: string[] = [];
  readonly resizes: Array<{ cols: number; rows: number }> = [];
  killed = false;
  autoExit = true;
  killCount = 0;
  readonly killRequested = Promise.withResolvers<void>();

  private readonly dataEmitter = new Emitter<string>();
  private readonly exitEmitter = new Emitter<{ exitCode: number | null }>();

  readonly onData = this.dataEmitter.event;
  readonly onExit = this.exitEmitter.event;

  write(data: string): void {
    this.writes.push(data);
  }

  resize(cols: number, rows: number): void {
    this.resizes.push({ cols, rows });
  }

  kill(): void {
    this.killed = true;
    this.killCount += 1;
    this.killRequested.resolve();
    if (this.autoExit) this.exitEmitter.fire({ exitCode: null });
  }

  emitData(data: string): void {
    this.dataEmitter.fire(data);
  }

  emitExit(exitCode: number | null): void {
    this.exitEmitter.fire({ exitCode });
  }
}

class FakeTerminalBackend implements TerminalBackend {
  readonly spawns: TerminalSpawnOptions[] = [];
  readonly processes: FakeTerminalProcess[] = [];

  async spawn(options: TerminalSpawnOptions): Promise<TerminalProcess> {
    this.spawns.push(options);
    const process = new FakeTerminalProcess();
    this.processes.push(process);
    return process;
  }
}

class Sink {
  readonly frames: TerminalFrame[] = [];

  constructor(readonly id: string) {}

  send(frame: TerminalFrame): void {
    this.frames.push(frame);
  }
}

function session(id: string, cwd: string): Session {
  return {
    id,
    workspace_id: `wd_${id}`,
    title: id,
    created_at: '2026-06-04T10:30:00.000Z',
    updated_at: '2026-06-04T10:30:00.000Z',
    status: 'idle',
    archived: false,
    metadata: { cwd },
    agent_config: { model: '' },
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      total_cost_usd: 0,
      context_tokens: 0,
      context_limit: 0,
      turn_count: 0,
    },
    permission_rules: [],
    message_count: 0,
    last_seq: 0,
  };
}

function makeSessionService(sessions: Map<string, Session>): ISessionService {
  const emptyEmitter = new Emitter<never>();
  return {
    _serviceBrand: undefined,
    create: async () => {
      throw new Error('not implemented');
    },
    list: async () => ({ items: [...sessions.values()], has_more: false }),
    get: async (id: string) => {
      const found = sessions.get(id);
      if (found === undefined) throw new SessionNotFoundError(id);
      return found;
    },
    update: async () => {
      throw new Error('not implemented');
    },
    fork: async () => {
      throw new Error('not implemented');
    },
    listChildren: async () => ({ items: [], has_more: false }),
    createChild: async () => {
      throw new Error('not implemented');
    },
    getStatus: async () => {
      throw new Error('not implemented');
    },
    getSessionWarnings: async () => [],
    compact: async () => {
      throw new Error('not implemented');
    },
    undo: async () => {
      throw new Error('not implemented');
    },
    archive: async () => {
      throw new Error('not implemented');
    },
    onDidCreate: emptyEmitter.event,
    onDidClose: emptyEmitter.event,
  };
}

describe('TerminalService.create', () => {
  it('starts a terminal in the session workspace by default', async () => {
    const root = join(tmpDir, 'workspace-a');
    mkdirSync(root, { recursive: true });
    const backend = new FakeTerminalBackend();
    const svc = new TerminalService({ backend }, makeSessionService(new Map([
      ['sess_a', session('sess_a', root)],
    ])));

    const terminal = await svc.create('sess_a', {});

    expect(terminal.session_id).toBe('sess_a');
    expect(terminal.cwd).toBe(await realpath(root));
    expect(backend.spawns[0]!.cwd).toBe(await realpath(root));
  });

  it('supports independent terminals for any number of sessions', async () => {
    const rootA = join(tmpDir, 'workspace-a');
    const rootB = join(tmpDir, 'workspace-b');
    mkdirSync(rootA, { recursive: true });
    mkdirSync(rootB, { recursive: true });
    const backend = new FakeTerminalBackend();
    const svc = new TerminalService({ backend }, makeSessionService(new Map([
      ['sess_a', session('sess_a', rootA)],
      ['sess_b', session('sess_b', rootB)],
    ])));

    const termA = await svc.create('sess_a', {});
    const termB = await svc.create('sess_b', {});

    expect(termA.id).not.toBe(termB.id);
    expect((await svc.list('sess_a')).map((t) => t.id)).toEqual([termA.id]);
    expect((await svc.list('sess_b')).map((t) => t.id)).toEqual([termB.id]);
    expect(backend.spawns.map((spawn) => spawn.cwd)).toEqual([
      await realpath(rootA),
      await realpath(rootB),
    ]);
  });

  it('resolves relative cwd overrides under the session workspace', async () => {
    const root = join(tmpDir, 'workspace-c');
    const nested = join(root, 'packages/server');
    mkdirSync(nested, { recursive: true });
    const backend = new FakeTerminalBackend();
    const svc = new TerminalService({ backend }, makeSessionService(new Map([
      ['sess_c', session('sess_c', root)],
    ])));

    const terminal = await svc.create('sess_c', { cwd: 'packages/server' });

    expect(terminal.cwd).toBe(await realpath(nested));
    expect(backend.spawns[0]!.cwd).toBe(await realpath(nested));
  });

  it('rejects cwd overrides that escape the session workspace', async () => {
    const root = join(tmpDir, 'workspace-d');
    mkdirSync(root, { recursive: true });
    const backend = new FakeTerminalBackend();
    const svc = new TerminalService({ backend }, makeSessionService(new Map([
      ['sess_d', session('sess_d', root)],
    ])));

    await expect(svc.create('sess_d', { cwd: '../outside' })).rejects.toBeInstanceOf(
      FsPathEscapesError,
    );
  });
});

describe('TerminalService streams', () => {
  it('buffers output and replays frames after since_seq', async () => {
    const root = join(tmpDir, 'workspace-e');
    mkdirSync(root, { recursive: true });
    const backend = new FakeTerminalBackend();
    const svc = new TerminalService({ backend }, makeSessionService(new Map([
      ['sess_e', session('sess_e', root)],
    ])));
    const terminal = await svc.create('sess_e', {});
    const process = backend.processes[0]!;

    process.emitData('first');
    process.emitData('second');

    const sink = new Sink('conn_1');
    const result = await svc.attach('sess_e', terminal.id, sink, { sinceSeq: 1 });

    expect(result).toEqual({ replayed: 1 });
    expect(sink.frames).toMatchObject([
      { type: 'terminal_output', seq: 2, payload: { data: 'second' } },
    ]);

    process.emitData('third');
    expect(sink.frames.at(-1)).toMatchObject({
      type: 'terminal_output',
      seq: 3,
      payload: { data: 'third' },
    });
  });

  it('writes input, resizes, detaches sinks, and closes the backend process', async () => {
    const root = join(tmpDir, 'workspace-f');
    mkdirSync(root, { recursive: true });
    const backend = new FakeTerminalBackend();
    const svc = new TerminalService({ backend }, makeSessionService(new Map([
      ['sess_f', session('sess_f', root)],
    ])));
    const terminal = await svc.create('sess_f', {});
    const process = backend.processes[0]!;
    const sink = new Sink('conn_2');
    await svc.attach('sess_f', terminal.id, sink);

    await svc.write('sess_f', terminal.id, 'pwd\r');
    await svc.resize('sess_f', terminal.id, 100, 40);
    svc.detach('sess_f', terminal.id, sink.id);
    process.emitData('after detach');
    const closeResult = await svc.close('sess_f', terminal.id);

    expect(process.writes).toEqual(['pwd\r']);
    expect(process.resizes).toEqual([{ cols: 100, rows: 40 }]);
    expect(sink.frames).toEqual([]);
    expect(closeResult).toEqual({ closed: true });
    expect(process.killed).toBe(true);
    expect((await svc.get('sess_f', terminal.id)).status).toBe('exited');
  });

  it('does not publish exit or finish close until the backend actually exits', async () => {
    const backend = new FakeTerminalBackend();
    const svc = new TerminalService({ backend }, makeSessionService(new Map([
      ['sess_delayed', session('sess_delayed', tmpDir)],
    ])));
    const terminal = await svc.create('sess_delayed', {});
    const process = backend.processes[0]!;
    process.autoExit = false;
    const sink = new Sink('delayed-close');
    await svc.attach('sess_delayed', terminal.id, sink);
    let closed = false;
    const closing = svc.close('sess_delayed', terminal.id).then((result) => {
      closed = true;
      return result;
    });
    await process.killRequested.promise;
    expect(closed).toBe(false);
    expect((await svc.get('sess_delayed', terminal.id)).status).toBe('running');
    expect(sink.frames).toEqual([]);
    process.emitData('last output');
    expect(sink.frames.at(-1)?.type).toBe('terminal_output');
    process.emitExit(7);
    await expect(closing).resolves.toEqual({ closed: true });
    expect((await svc.get('sess_delayed', terminal.id)).exit_code).toBe(7);
    expect(sink.frames.at(-1)).toMatchObject({
      type: 'terminal_exit',
      payload: { exit_code: 7 },
    });
    await svc.shutdown();
  });

  it('shutdown holds listeners and awaits every independent terminal exit', async () => {
    const backend = new FakeTerminalBackend();
    const svc = new TerminalService({ backend }, makeSessionService(new Map([
      ['sess_shutdown', session('sess_shutdown', tmpDir)],
    ])));
    const first = await svc.create('sess_shutdown', {});
    const second = await svc.create('sess_shutdown', {});
    for (const process of backend.processes) process.autoExit = false;
    const sink = new Sink('shutdown');
    await svc.attach('sess_shutdown', second.id, sink);
    let settled = false;
    svc.dispose();
    const shutdown = svc.shutdown();
    expect(svc.shutdown()).toBe(shutdown);
    const completion = shutdown.then(() => { settled = true; });
    await Promise.all(backend.processes.map((process) => process.killRequested.promise));
    await expect(svc.create('sess_shutdown', {})).rejects.toThrow(/disposed/);
    expect(settled).toBe(false);
    backend.processes[0]!.emitExit(0);
    expect((await svc.get('sess_shutdown', first.id)).status).toBe('exited');
    expect(settled).toBe(false);
    backend.processes[1]!.emitData('final bytes');
    backend.processes[1]!.emitExit(0);
    await completion;
    expect(sink.frames.map((frame) => frame.type)).toEqual(['terminal_output', 'terminal_exit']);
    expect(backend.processes.map((process) => process.killCount)).toEqual([1, 1]);
  });

  it('shutdown owns a terminal whose native spawn is still pending', async () => {
    const spawnRequested = Promise.withResolvers<void>();
    const spawned = Promise.withResolvers<TerminalProcess>();
    const process = new FakeTerminalProcess();
    process.autoExit = false;
    const backend: TerminalBackend = {
      spawn: () => {
        spawnRequested.resolve();
        return spawned.promise;
      },
    };
    const svc = new TerminalService({ backend }, makeSessionService(new Map([
      ['sess_spawn', session('sess_spawn', tmpDir)],
    ])));
    const creation = svc.create('sess_spawn', {});
    await spawnRequested.promise;
    let settled = false;
    const shutdown = svc.shutdown().then(() => { settled = true; });
    spawned.resolve(process);
    await process.killRequested.promise;
    expect(settled).toBe(false);
    process.emitExit(0);
    expect((await creation).status).toBe('exited');
    await shutdown;
    expect(settled).toBe(true);
  });

  it('settles a real native PTY before publishing completed shutdown', async () => {
    const svc = new TerminalService({}, makeSessionService(new Map([
      ['sess_native', session('sess_native', tmpDir)],
    ])));
    const ready = Promise.withResolvers<void>();
    const sink = new Sink('native');
    let output = '';
    try {
      const terminal = await svc.create('sess_native', { shell: process.execPath });
      await svc.attach('sess_native', terminal.id, {
        id: sink.id,
        send(frame) {
          sink.send(frame);
          if (frame.type === 'terminal_output') {
            output += frame.payload.data;
            if (output.includes('native-terminal-ready\r\n')) ready.resolve();
          }
        },
      });
      await svc.write('sess_native', terminal.id, "process.on('SIGHUP', () => {}); process.stdout.write('native-terminal-' + 'ready\\n')\r");
      await ready.promise;
      expect(isSessionWorktreeOwned(tmpDir, tmpDir)).toBe(true);
      await svc.shutdown();
      expect(sink.frames.at(-1)?.type).toBe('terminal_exit');
      expect(isSessionWorktreeOwned(tmpDir, tmpDir)).toBe(false);
    } finally {
      await svc.shutdown();
    }
  });

  it('surfaces a native stop failure without reporting the terminal exited', async () => {
    const backend = new FakeTerminalBackend();
    const svc = new TerminalService({ backend }, makeSessionService(new Map([
      ['sess_stop_failure', session('sess_stop_failure', tmpDir)],
    ])));
    const terminal = await svc.create('sess_stop_failure', {});
    const process = backend.processes[0]!;
    const failure = new Error('native kill failed');
    process.kill = () => { throw failure; };
    const sink = new Sink('stop-failure');
    await svc.attach('sess_stop_failure', terminal.id, sink);
    await expect(svc.close('sess_stop_failure', terminal.id)).rejects.toBe(failure);
    expect((await svc.get('sess_stop_failure', terminal.id)).status).toBe('running');
    expect(sink.frames).toEqual([]);
    const shutdown = svc.shutdown();
    await expect(shutdown).rejects.toBeInstanceOf(AggregateError);
    expect(svc.shutdown()).toBe(shutdown);
    process.emitExit(0);
    expect(sink.frames.at(-1)?.type).toBe('terminal_exit');
  });

  it('throws TerminalNotFoundError when terminal_id is not owned by that session', async () => {
    const rootA = join(tmpDir, 'workspace-g-a');
    const rootB = join(tmpDir, 'workspace-g-b');
    mkdirSync(rootA, { recursive: true });
    mkdirSync(rootB, { recursive: true });
    const backend = new FakeTerminalBackend();
    const svc = new TerminalService({ backend }, makeSessionService(new Map([
      ['sess_a', session('sess_a', rootA)],
      ['sess_b', session('sess_b', rootB)],
    ])));
    const terminal = await svc.create('sess_a', {});

    await expect(svc.get('sess_b', terminal.id)).rejects.toBeInstanceOf(
      TerminalNotFoundError,
    );
  });

  it('falls back to the platform shell when $SHELL is set but blank', async () => {
    const root = join(tmpDir, 'workspace-h');
    mkdirSync(root, { recursive: true });
    const previous = process.env['SHELL'];
    process.env['SHELL'] = '   ';
    try {
      const backend = new FakeTerminalBackend();
      const svc = new TerminalService({ backend }, makeSessionService(new Map([
        ['sess_h', session('sess_h', root)],
      ])));

      await svc.create('sess_h', {});

      // A blank path must never reach node-pty: it spawns '' and dies with
      // "posix_spawnp failed" before the terminal exists.
      expect(backend.spawns[0]!.shell).toBe(
        process.platform === 'win32' ? 'powershell.exe' : '/bin/sh',
      );
    } finally {
      if (previous === undefined) delete process.env['SHELL'];
      else process.env['SHELL'] = previous;
    }
  });

  it.skipIf(process.platform === 'win32')(
    'falls back to /bin/sh when $SHELL names a path that no longer exists',
    async () => {
      const root = join(tmpDir, 'workspace-i');
      mkdirSync(root, { recursive: true });
      const previous = process.env['SHELL'];
      process.env['SHELL'] = join(tmpDir, 'missing-shell');
      try {
        const backend = new FakeTerminalBackend();
        const svc = new TerminalService({ backend }, makeSessionService(new Map([
          ['sess_i', session('sess_i', root)],
        ])));

        await svc.create('sess_i', {});

        expect(backend.spawns[0]!.shell).toBe('/bin/sh');
      } finally {
        if (previous === undefined) delete process.env['SHELL'];
        else process.env['SHELL'] = previous;
      }
    },
  );
});
