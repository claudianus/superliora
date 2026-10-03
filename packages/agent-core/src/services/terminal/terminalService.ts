import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';

import { Disposable, registerSingleton, SyncDescriptor } from '../../di';
import type { IDisposable } from '../../di';
import { log } from '../../logging/logger';
import { registerSessionWorktreeOwnershipGuard, sessionWorktreeContainsPath } from '../../session/worktree';
import type {
  CreateTerminalRequest,
  Terminal,
  TerminalExitMessage,
  TerminalOutputMessage,
} from '@superliora/protocol';
import { ulid } from 'ulid';

import { resolveSafePath } from '../fs/fsPathSafety';
import { ISessionService } from '../session/session';
import {
  disposeAll,
  ITerminalService,
  TerminalNotFoundError,
  type TerminalAttachOptions,
  type TerminalAttachSink,
  type TerminalBackend,
  type TerminalFrame,
  type TerminalProcess,
  type TerminalServiceOptions,
  type TerminalSpawnOptions,
} from './terminal';

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const DEFAULT_MAX_BUFFERED_FRAMES = 2000;

interface TerminalRecord {
  terminal: Terminal;
  process: TerminalProcess;
  sinks: Map<string, TerminalAttachSink>;
  buffer: TerminalFrame[];
  nextSeq: number;
  disposables: IDisposable[];
  stopping: boolean;
  settled: Promise<void>;
  settle: () => void;
  stopFailure?: { error: unknown };
}

export class TerminalService extends Disposable implements ITerminalService {
  readonly _serviceBrand: undefined;

  private readonly backend: TerminalBackend;
  private readonly defaultShell: string;
  private readonly defaultCols: number;
  private readonly defaultRows: number;
  private readonly maxBufferedFrames: number;
  private readonly records = new Map<string, TerminalRecord>();
  private readonly pendingCreates = new Set<Promise<Terminal>>();
  private closing = false;
  private shutdownPromise: Promise<void> | undefined;

  constructor(
    options: TerminalServiceOptions = {},
    @ISessionService private readonly sessionService: ISessionService,
  ) {
    super();
    this.backend = options.backend ?? new NodePtyTerminalBackend();
    this.defaultShell = options.defaultShell ?? defaultShell();
    this.defaultCols = options.defaultCols ?? DEFAULT_COLS;
    this.defaultRows = options.defaultRows ?? DEFAULT_ROWS;
    this.maxBufferedFrames = options.maxBufferedFrames ?? DEFAULT_MAX_BUFFERED_FRAMES;
    this._register({
      dispose: registerSessionWorktreeOwnershipGuard((path) => {
        for (const record of this.records.values()) {
          if (record.terminal.status !== 'exited' && sessionWorktreeContainsPath(path, record.terminal.cwd)) return true;
        }
        return false;
      }),
    });
  }

  create(sessionId: string, input: CreateTerminalRequest): Promise<Terminal> {
    if (this.closing) {
      return Promise.reject(new Error('TerminalService has been disposed'));
    }
    const creation = this.createTerminal(sessionId, input).finally(() => {
      this.pendingCreates.delete(creation);
    });
    this.pendingCreates.add(creation);
    return creation;
  }

  private async createTerminal(sessionId: string, input: CreateTerminalRequest): Promise<Terminal> {
    const session = await this.sessionService.get(sessionId);
    const cwd =
      input.cwd === undefined
        ? await fs.realpath(session.metadata.cwd)
        : (await resolveSafePath(session.metadata.cwd, input.cwd)).absolute;
    const shell = input.shell ?? this.defaultShell;
    const cols = input.cols ?? this.defaultCols;
    const rows = input.rows ?? this.defaultRows;
    const process = await this.backend.spawn({ cwd, shell, cols, rows });
    const settlement = Promise.withResolvers<void>();
    const terminal: Terminal = {
      id: `term_${ulid()}`,
      session_id: sessionId,
      cwd,
      shell,
      cols,
      rows,
      status: 'running',
      created_at: new Date().toISOString(),
    };
    const record: TerminalRecord = {
      terminal,
      process,
      sinks: new Map(),
      buffer: [],
      nextSeq: 0,
      disposables: [],
      stopping: false,
      settled: settlement.promise,
      settle: settlement.resolve,
    };
    record.disposables.push(
      process.onData((data) =>{  this.onData(record, data); }),
      process.onExit((event) =>{  this.onExit(record, event.exitCode); }),
    );
    this.records.set(recordKey(sessionId, terminal.id), record);
    if (this.closing) {
      this.requestStop(record);
      await record.settled;
    }
    return { ...record.terminal };
  }

  async list(sessionId: string): Promise<readonly Terminal[]> {
    await this.sessionService.get(sessionId);
    return [...this.records.values()]
      .filter((record) => record.terminal.session_id === sessionId)
      .map((record) => ({ ...record.terminal }));
  }

  async get(sessionId: string, terminalId: string): Promise<Terminal> {
    return { ...(await this.requireRecord(sessionId, terminalId)).terminal };
  }

  async attach(
    sessionId: string,
    terminalId: string,
    sink: TerminalAttachSink,
    options: TerminalAttachOptions = {},
  ): Promise<{ replayed: number }> {
    const record = await this.requireRecord(sessionId, terminalId);
    record.sinks.set(sink.id, sink);
    const sinceSeq = options.sinceSeq ?? 0;
    const replay = record.buffer.filter((frame) => frameSeq(frame) > sinceSeq);
    for (const frame of replay) {
      sink.send(frame);
    }
    return { replayed: replay.length };
  }

  detach(sessionId: string, terminalId: string, sinkId: string): void {
    this.records.get(recordKey(sessionId, terminalId))?.sinks.delete(sinkId);
  }

  detachAllForSink(sinkId: string): void {
    for (const record of this.records.values()) {
      record.sinks.delete(sinkId);
    }
  }

  async write(sessionId: string, terminalId: string, data: string): Promise<void> {
    const record = await this.requireRecord(sessionId, terminalId);
    if (this.closing || record.stopping) {
      throw new Error('TerminalService is shutting down this terminal');
    }
    record.process.write(data);
  }

  async resize(
    sessionId: string,
    terminalId: string,
    cols: number,
    rows: number,
  ): Promise<void> {
    const record = await this.requireRecord(sessionId, terminalId);
    if (this.closing || record.stopping) {
      throw new Error('TerminalService is shutting down this terminal');
    }
    record.terminal = { ...record.terminal, cols, rows };
    record.process.resize(cols, rows);
  }

  async close(sessionId: string, terminalId: string): Promise<{ closed: true }> {
    const record = await this.requireRecord(sessionId, terminalId);
    this.requestStop(record);
    await record.settled;
    return { closed: true };
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise !== undefined) return this.shutdownPromise;
    this.closing = true;
    const completion = Promise.withResolvers<void>();
    this.shutdownPromise = completion.promise;
    void this.shutdownNative().then(completion.resolve, completion.reject);
    return this.shutdownPromise;
  }

  private async shutdownNative(): Promise<void> {
    const exits = Array.from(this.records.values(), async (record) => {
      this.requestStop(record);
      await record.settled;
    });
    const results = await Promise.allSettled([...exits, ...this.pendingCreates]);
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length > 0) {
      throw new AggregateError(failures.map((result) => result.reason), 'native terminal shutdown failed');
    }
    this.records.clear();
    super.dispose();
  }

  override dispose(): void {
    void this.shutdown().catch((error: unknown) => {
      log.error('native terminal shutdown failed', { error });
    });
  }

  private requestStop(record: TerminalRecord): void {
    if (record.stopFailure !== undefined) throw record.stopFailure.error;
    if (record.stopping || record.terminal.status === 'exited') return;
    record.stopping = true;
    try {
      record.process.kill();
    } catch (error) {
      record.stopFailure = { error };
      throw error;
    }
  }

  private async requireRecord(
    sessionId: string,
    terminalId: string,
  ): Promise<TerminalRecord> {
    await this.sessionService.get(sessionId);
    const record = this.records.get(recordKey(sessionId, terminalId));
    if (record === undefined) {
      throw new TerminalNotFoundError(sessionId, terminalId);
    }
    return record;
  }

  private onData(record: TerminalRecord, data: string): void {
    const frame: TerminalOutputMessage = {
      type: 'terminal_output',
      seq: ++record.nextSeq,
      session_id: record.terminal.session_id,
      terminal_id: record.terminal.id,
      timestamp: new Date().toISOString(),
      payload: { data },
    };
    this.pushFrame(record, frame);
  }

  private onExit(record: TerminalRecord, exitCode: number | null): void {
    if (record.terminal.status === 'exited') return;
    record.stopping = true;
    record.terminal = {
      ...record.terminal,
      status: 'exited',
      exited_at: new Date().toISOString(),
      exit_code: exitCode,
    };
    const frame: TerminalExitMessage = {
      type: 'terminal_exit',
      session_id: record.terminal.session_id,
      terminal_id: record.terminal.id,
      timestamp: new Date().toISOString(),
      payload: { exit_code: exitCode },
    };
    try {
      this.pushFrame(record, frame);
    } finally {
      disposeAll(record.disposables);
      record.disposables = [];
      record.settle();
    }
  }

  private pushFrame(record: TerminalRecord, frame: TerminalFrame): void {
    record.buffer.push(frame);
    if (record.buffer.length > this.maxBufferedFrames) {
      record.buffer.splice(0, record.buffer.length - this.maxBufferedFrames);
    }
    for (const sink of record.sinks.values()) {
      sink.send(frame);
    }
  }
}

export class NodePtyTerminalBackend implements TerminalBackend {
  async spawn(options: TerminalSpawnOptions): Promise<TerminalProcess> {
    const pty = await import('node-pty');
    const proc = pty.spawn(options.shell, [], {
      name: 'xterm-256color',
      cwd: options.cwd,
      cols: options.cols,
      rows: options.rows,
      env: process.env,
    });
    return {
      onData: (listener) => proc.onData(listener),
      onExit: (listener) =>
        proc.onExit((event) => listener({ exitCode: event.signal ? null : event.exitCode })),
      write: (data) =>{  proc.write(data); },
      resize: (cols, rows) =>{  proc.resize(cols, rows); },
      kill: () =>{  proc.kill('SIGKILL'); },
    };
  }
}

function recordKey(sessionId: string, terminalId: string): string {
  return `${sessionId}\0${terminalId}`;
}

function frameSeq(frame: TerminalFrame): number {
  return frame.type === 'terminal_output' ? frame.seq : Number.MAX_SAFE_INTEGER;
}

function defaultShell(): string {
  if (os.platform() === 'win32') {
    // Git Bash / MSYS2 export a POSIX-spelled SHELL (/usr/bin/bash) to every
    // child; CreateProcessW cannot launch that, so only a Windows-spelled path
    // is usable here.
    const shell = process.env['SHELL']?.trim();
    return shell !== undefined && /^[A-Za-z]:[\\/]/.test(shell) ? shell : 'powershell.exe';
  }
  // An EMPTY $SHELL (set but blank, as some daemon/launchd envs leave it) and a
  // path that no longer exists must both fall back, or node-pty spawns a bad
  // path and fails with "posix_spawnp failed".
  const shell = process.env['SHELL']?.trim();
  return shell !== undefined && shell.length > 0 && existsSync(shell) ? shell : '/bin/sh';
}

registerSingleton(
  ITerminalService,
  new SyncDescriptor(TerminalService, [{}], false),
);
