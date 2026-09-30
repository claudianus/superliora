import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath, { join } from 'node:path';

import { FSWatcher } from 'chokidar';

import { Disposable, DisposableMap, ReferenceCollection, dispose } from '../../di';
import type { IDisposable, IReference } from '../../di';
import { ISessionService } from '../session/session';

import type {
  FsChangeAction,
  FsChangeEntry,
  FsChangeKind,
} from '@superliora/protocol';

import { ILogService } from '../logger/logger';
import {
  IFsWatcher,
  FsWatchLimitError,
  type FsChangedFrame,
  type FsWatcherConnectionLookup,
  type FsWatcherServiceOptions,
} from './fsWatcher';

const DEFAULT_DEBOUNCE_MS = 200;
/** Hard cap so continuous activity cannot starve event.fs.changed forever. */
const DEFAULT_MAX_COALESCE_MS = 2_000;

const DEFAULT_MAX_CHANGES_PER_WINDOW = 500;

const DEFAULT_MAX_PATHS_PER_CONNECTION = 100;

/**
 * Windows and macOS filesystems are case-insensitive, but chokidar reports
 * paths in the on-disk casing, which is independent of the casing a client
 * registered. Comparing raw strings meant a client watching `C:\repo\Src`
 * received no `event.fs.changed` for an edit reported as `c:\repo\src\a.ts`.
 * Fold case the way `path-access.isWithinDirectory` already does, so path
 * identity matches filesystem identity.
 *
 * Separators are normalized as well: the same path reaches this service both
 * `/`-normalized (pathe) and with the platform separator, and a comparison
 * that keeps them distinct drops every event for a path spelled the other way.
 */
/**
 * Whether path identity is case-insensitive here.
 *
 * Probed rather than assumed from `process.platform`: a Linux container on a
 * case-insensitive mount (macOS/Windows host directory, CI workspace volumes)
 * reports `linux` yet folds case, and comparing raw strings there drops every
 * event for a path spelled with different casing.
 *
 * Evaluated on first use, not at import: this module is pulled in by the
 * service barrel, and touching the filesystem at import time would run under
 * whatever module mocks are active in the importing test.
 */
let foldCase: boolean | undefined;

function isCaseInsensitiveFs(): boolean {
  if (foldCase !== undefined) return foldCase;
  const probeDir = join(tmpdir(), `.liora-case-probe-${process.pid}`);
  try {
    mkdirSync(probeDir, { recursive: true });
    writeFileSync(join(probeDir, 'CaseProbe'), 'x');
    foldCase = existsSync(join(probeDir, 'caseprobe'));
  } catch {
    foldCase = false;
  } finally {
    try {
      rmSync(probeDir, { recursive: true, force: true });
    } catch {
      // A leftover probe directory is harmless.
    }
  }
  return foldCase;
}

function comparablePath(p: string): string {
  const unified = p.replaceAll('\\', '/');
  return isCaseInsensitiveFs() ? unified.toLowerCase() : unified;
}

interface PendingChange {
  absPath: string;
  action: FsChangeAction;
  kind: FsChangeKind;
}

class PathReferenceCollection extends ReferenceCollection<string> {
  // Keyed on the folded form: on a case-insensitive filesystem `a.ts` and
  // `A.ts` are the same file, so two spellings must share one refcount entry.
  // Keying on the raw string registered two watches, and releasing one
  // spelling left the chokidar watch live forever.
  private readonly activePaths = new Set<string>();

  constructor(private readonly watcher: FSWatcher) {
    super();
  }

  get size(): number {
    return this.activePaths.size;
  }

  protected createReferencedObject(absPath: string): string {
    this.watcher.add(absPath);
    this.activePaths.add(comparablePath(absPath));
    return absPath;
  }

  protected destroyReferencedObject(absPath: string): void {
    this.activePaths.delete(comparablePath(absPath));
    this.watcher.unwatch(absPath);
  }
}

class SessionEntry implements IDisposable {
  readonly pathRefs: PathReferenceCollection;
  readonly connectionPathRefs = new Map<string, Map<string, IReference<string>>>();
  pendingChanges: PendingChange[] = [];
  pendingRawCount = 0;
  truncated = false;
  debounceTimer: NodeJS.Timeout | undefined = undefined;
  /** Wall-clock start of the open coalesce window (first event in the burst). */
  windowStartedAtMs: number | undefined = undefined;
  seq = 0;
  private _disposed = false;

  constructor(
    public readonly sessionId: string,
    public readonly watcher: FSWatcher,
    public cwd: string,
    private readonly logger: ILogService,
  ) {
    this.pathRefs = new PathReferenceCollection(watcher);
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    void this.watcher.close().catch((error) => {
      this.logger.warn(
        { sessionId: this.sessionId, err: String(error) },
        'fs-watcher close failed',
      );
    });
  }
}

export class FsWatcherService extends Disposable implements IFsWatcher {
  readonly _serviceBrand: undefined;

  private readonly debounceMs: number;
  private readonly maxCoalesceMs: number;
  private readonly maxChangesPerWindow: number;
  private readonly maxPathsPerConnection: number;
  private readonly makeWatcher: () => FSWatcher;
  private readonly sessions: DisposableMap<string, SessionEntry>;

  private readonly connections = new Map<
    string,
    Map<string, Map<string, IReference<string>>>
  >();

  constructor(
    private readonly lookup: FsWatcherConnectionLookup,
    options: FsWatcherServiceOptions,
    @ILogService private readonly logger: ILogService,
    @ISessionService _sessionService: ISessionService,
  ) {
    super();
    this.sessions = this._register(new DisposableMap<string, SessionEntry>());
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.maxCoalesceMs = Math.max(
      this.debounceMs,
      options.maxCoalesceMs ?? DEFAULT_MAX_COALESCE_MS,
    );
    this.maxChangesPerWindow =
      options.maxChangesPerWindow ?? DEFAULT_MAX_CHANGES_PER_WINDOW;
    this.maxPathsPerConnection =
      options.maxPathsPerConnection ?? DEFAULT_MAX_PATHS_PER_CONNECTION;
    this.makeWatcher =
      options.watcherFactory ??
      (() =>
        new FSWatcher({
          ignoreInitial: true,
          persistent: false,
          ignored: (p: string) => /(?:^|[/\\])\.git(?:$|[/\\])/.test(p),
        }));
  }

  addPaths(
    sessionId: string,
    connectionId: string,
    absPaths: readonly string[],
  ): readonly string[] {
    if (this._store.isDisposed) return [];

    const connSessions = this.getOrCreateConnection(connectionId);
    let existingForSession = connSessions.get(sessionId);
    const newlyAdded: string[] = [];
    let projectedTotal = this.countForConnection(connectionId);
    for (const abs of absPaths) {
      if (existingForSession?.has(abs)) continue;
      newlyAdded.push(abs);
      projectedTotal += 1;
    }
    if (projectedTotal > this.maxPathsPerConnection) {
      throw new FsWatchLimitError(
        connectionId,
        projectedTotal,
        this.maxPathsPerConnection,
      );
    }
    if (newlyAdded.length === 0) {
      return existingForSession ? Array.from(existingForSession.keys()) : [];
    }

    let entry = this.sessions.get(sessionId);
    if (!entry) {
      entry = this.createSessionEntry(sessionId, deriveSharedCwd(newlyAdded));
      this.sessions.set(sessionId, entry);
    }

    if (!existingForSession) {
      existingForSession = new Map();
      connSessions.set(sessionId, existingForSession);
      entry.connectionPathRefs.set(connectionId, existingForSession);
    }
    for (const abs of newlyAdded) {
      existingForSession.set(abs, entry.pathRefs.acquire(abs));
    }
    return Array.from(existingForSession.keys());
  }

  removePaths(
    sessionId: string,
    connectionId: string,
    absPaths: readonly string[],
  ): readonly string[] {
    if (this._store.isDisposed) return [];
    const entry = this.sessions.get(sessionId);
    if (!entry) return [];
    const connSessions = this.connections.get(connectionId);
    const connSessionRefs = connSessions?.get(sessionId);
    if (!connSessionRefs) return [];

    const refsToDispose: IReference<string>[] = [];
    for (const abs of absPaths) {
      const ref = connSessionRefs.get(abs);
      if (!ref) continue;
      connSessionRefs.delete(abs);
      refsToDispose.push(ref);
    }

    try {
      dispose(refsToDispose);
    } finally {
      if (connSessionRefs.size === 0) {
        connSessions?.delete(sessionId);
        entry.connectionPathRefs.delete(connectionId);
        if (connSessions && connSessions.size === 0) {
          this.connections.delete(connectionId);
        }
      }

      if (entry.pathRefs.size === 0) {
        this.sessions.deleteAndDispose(sessionId);
      }
    }
    return connSessionRefs ? Array.from(connSessionRefs.keys()) : [];
  }

  countForConnection(connectionId: string): number {
    const m = this.connections.get(connectionId);
    if (!m) return 0;
    let total = 0;
    for (const refs of m.values()) total += refs.size;
    return total;
  }

  forgetConnection(connectionId: string): void {
    const sessionMap = this.connections.get(connectionId);
    if (!sessionMap) return;

    const entries = Array.from(sessionMap.entries());
    const removals = entries.map(([sid, refs]) => ({
      dispose: () => {
        this.removePaths(sid, connectionId, Array.from(refs.keys()));
      },
    }));
    try {
      dispose(removals);
    } finally {
      this.connections.delete(connectionId);
    }
  }

  watchedPaths(connectionId: string, sessionId: string): readonly string[] {
    const refs = this.connections.get(connectionId)?.get(sessionId);
    if (!refs) return [];
    return Array.from(refs.keys());
  }

  bindSessionCwd(sessionId: string, cwd: string): void {
    let entry = this.sessions.get(sessionId);
    if (!entry) {
      entry = this.createSessionEntry(sessionId, cwd);
      this.sessions.set(sessionId, entry);
      return;
    }
    if (entry.cwd !== cwd) {
      this.logger.debug(
        { sessionId, oldCwd: entry.cwd, newCwd: cwd },
        'fs-watcher cwd override',
      );
      entry.cwd = cwd;
    }
  }

  private getOrCreateConnection(
    connectionId: string,
  ): Map<string, Map<string, IReference<string>>> {
    let m = this.connections.get(connectionId);
    if (!m) {
      m = new Map();
      this.connections.set(connectionId, m);
    }
    return m;
  }

  private createSessionEntry(sessionId: string, cwd: string): SessionEntry {
    const watcher = this.makeWatcher();
    const entry = new SessionEntry(sessionId, watcher, cwd, this.logger);
    watcher.on(
      'all',
      (eventName: string, absPath: string) => {
        this.onRawChange(sessionId, entry, eventName, absPath);
      },
    );
    watcher.on('error', (err) => {
      this.logger.warn(
        { sessionId, err: String(err) },
        'fs-watcher chokidar error',
      );
    });
    return entry;
  }

  private onRawChange(
    sessionId: string,
    entry: SessionEntry,
    eventName: string,
    absPath: string,
  ): void {
    if (this._store.isDisposed) return;
    const action = mapChokidarEventToAction(eventName);
    if (action === undefined) return;
    const kind = mapChokidarEventToKind(eventName);

    entry.pendingRawCount += 1;
    if (!entry.truncated) {
      entry.pendingChanges.push({ absPath, action, kind });
      if (entry.pendingChanges.length > this.maxChangesPerWindow) {
        entry.truncated = true;
        entry.pendingChanges = [];
      }
    }

    // Trailing debounce with a hard max window: restart quiet-period on each
    // event so short bursts coalesce, but continuous activity must flush by
    // maxCoalesceMs so event.fs.changed is never starved indefinitely.
    const now = Date.now();
    entry.windowStartedAtMs ??= now;
    const elapsed = now - entry.windowStartedAtMs;
    if (elapsed >= this.maxCoalesceMs) {
      if (entry.debounceTimer !== undefined) {
        clearTimeout(entry.debounceTimer);
        entry.debounceTimer = undefined;
      }
      this.flushWindow(sessionId);
      return;
    }
    if (entry.debounceTimer !== undefined) {
      clearTimeout(entry.debounceTimer);
      entry.debounceTimer = undefined;
    }
    // Quiet period = debounceMs, but clamp so the open window never exceeds maxCoalesceMs.
    const remainingInMaxWindow = Math.max(1, this.maxCoalesceMs - elapsed);
    const timer = setTimeout(() => {
      this.flushWindow(sessionId);
    }, Math.min(this.debounceMs, remainingInMaxWindow));
    timer.unref?.();
    entry.debounceTimer = timer;
  }

  private flushWindow(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    entry.debounceTimer = undefined;
    if (entry.pendingRawCount === 0) return;
    const truncated = entry.truncated;
    const rawCount = entry.pendingRawCount;
    const pending = entry.pendingChanges;
    const startedAt = entry.windowStartedAtMs;
    const coalescedWindowMs =
      startedAt === undefined
        ? this.debounceMs
        : Math.max(this.debounceMs, Math.min(this.maxCoalesceMs, Date.now() - startedAt));

    entry.pendingChanges = [];
    entry.pendingRawCount = 0;
    entry.truncated = false;
    entry.windowStartedAtMs = undefined;

    for (const [connectionId, connPathRefs] of entry.connectionPathRefs) {
      const sink = this.lookup.resolve(connectionId);
      if (!sink) continue;
      let perConnChanges: FsChangeEntry[];
      if (truncated) {
        perConnChanges = [];
      } else {
        perConnChanges = [];
        for (const ch of pending) {
          if (!isUnderAny(ch.absPath, connPathRefs.keys())) continue;
          const relPath = toPosixRelative(entry.cwd, ch.absPath);
          perConnChanges.push({
            path: relPath,
            change: ch.action,
            kind: ch.kind,
          });
        }
        if (perConnChanges.length === 0) continue;
      }
      entry.seq += 1;
      const frame: FsChangedFrame = {
        type: 'event.fs.changed',
        seq: entry.seq,
        session_id: sessionId,
        timestamp: new Date().toISOString(),
        payload: {
          changes: perConnChanges,
          coalesced_window_ms: coalescedWindowMs,
          ...(truncated ? { truncated: true, count: rawCount } : {}),
        },
      };
      try {
        sink.send(frame);
      } catch (error) {
        this.logger.warn(
          { connectionId, err: String(error) },
          'fs-watcher send failed',
        );
      }
    }
  }

  override dispose(): void {
    if (this._store.isDisposed) return;
    this.connections.clear();
    super.dispose();
  }
}

function mapChokidarEventToAction(name: string): FsChangeAction | undefined {
  switch (name) {
    case 'add':
    case 'addDir':
      return 'created';
    case 'change':
      return 'modified';
    case 'unlink':
    case 'unlinkDir':
      return 'deleted';
    default:
      return undefined;
  }
}

function mapChokidarEventToKind(name: string): FsChangeKind {
  switch (name) {
    case 'addDir':
    case 'unlinkDir':
      return 'directory';
    default:
      return 'file';
  }
}

/** @internal exported for tests — path identity must match FS identity. */
export function isUnderAny(absPath: string, parents: Iterable<string>): boolean {
  const target = comparablePath(absPath);
  for (const parent of parents) {
    const base = comparablePath(parent);
    if (target === base) return true;
    // Both separators: the same path can arrive `/`-normalized (pathe) or
    // with the platform separator, and a mismatch here silently drops every
    // event for that path.
    if (target.startsWith(`${base}/`) || target.startsWith(`${base}\\`)) return true;
  }
  return false;
}

function toPosixRelative(cwd: string, abs: string): string {
  if (comparablePath(abs) === comparablePath(cwd)) return '.';
  const rel = nodePath.relative(cwd, abs);
  if (rel === '') return '.';
  return rel.split(nodePath.sep).join('/');
}

/**
 * Split into path segments.
 *
 * Both separators, not just `nodePath.sep`: this code runs on Windows but
 * deals in the `/`-normalized paths that pathe produces, so splitting on `\`
 * there yields one bogus segment and collapses the shared root to `/` —
 * which roots the watcher at an entire drive.
 */
function toSegments(p: string): string[] {
  return p.split(/[/\\]/);
}

/** @internal exported for tests — mixed casing must not widen the root. */
export function deriveSharedCwd(absPaths: readonly string[]): string {
  if (absPaths.length === 0) return '/';
  if (absPaths.length === 1) return nodePath.dirname(absPaths[0]!);

  // Compare folded segments so a mixed-casing pair still yields their real
  // common ancestor instead of an empty prefix (which would watch a whole drive).
  //
  // Folding here is unconditional, unlike `comparablePath`: the inputs are
  // paths from a client that may be watching a Windows workspace from any host,
  // and a narrower root is only ever the safe failure. Deriving too wide
  // watches a whole drive; deriving too narrow means no events.
  let prefix = toSegments(absPaths[0]!);
  let prefixFolded = prefix.map((s) => s.toLowerCase());
  for (let i = 1; i < absPaths.length; i++) {
    const segs = toSegments(absPaths[i]!);
    const folded = segs.map((s) => s.toLowerCase());
    let j = 0;
    while (j < prefix.length && j < segs.length && prefixFolded[j] === folded[j]) j++;
    prefix = prefix.slice(0, j);
    prefixFolded = prefixFolded.slice(0, j);
  }
  if (prefix.length === 0) return rootOf(absPaths[0]!);
  // Always `/`-joined, never the host separator: chokidar and the path
  // helpers here both speak `/`, and a `\` root on Windows would not match
  // the watched paths it is derived from.
  return prefix.join('/') || '/';
}

/**
 * Root of an absolute path, parsed from the string rather than via
 * `nodePath.parse`: that is host-dependent, so on a POSIX dev box a
 * `C:/…` path parses as having no root at all and the fallback degraded to
 * `/` — exactly the drive-wide watch this derivation exists to prevent.
 */
function rootOf(p: string): string {
  const unified = p.replaceAll('\\', '/');
  const drive = /^([A-Za-z]:)\//.exec(unified);
  if (drive !== null) return `${drive[1]}/`;
  // Relative or non-drive input: `/` is what chokidar would treat as "watch
  // everything", and it is the only root this service can honour portably.
  return '/';
}
