/**
 * Home-directory storage garbage collection.
 *
 * Reclaims stale cache extracts, worktree temp debris, and optional idle
 * session wires — never active session dirs or locked jsonl files.
 */
import { open, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'pathe';

import { worktreesRoot } from '#/session/worktree';
import { compressWireJsonl, WIRE_JSONL, WIRE_JSONL_GZ } from '#/session/store/wire-gzip';

export interface StorageGcOptions {
  readonly homeDir: string;
  /** When true, report candidates only — never delete. Default false. */
  readonly dryRun?: boolean;
  /**
   * Skip session dirs whose state.json or wire mtime is newer than this
   * many ms. Default: 7 days. Active sessions stay hot.
   */
  readonly idleMs?: number;
  /** Also gzip plain closed-session wires. Default true. */
  readonly compressIdleWires?: boolean;
  /** Prune cache/releases extracts older than idleMs. Default true. */
  readonly pruneCache?: boolean;
  /** Prune worktree tmp debris. Default true. */
  readonly pruneWorktreeTmp?: boolean;
  /** Now override for tests. */
  readonly now?: number;
}

export interface StorageGcItem {
  readonly path: string;
  readonly kind: 'wire-gzip' | 'cache' | 'worktree-tmp' | 'skipped-active' | 'skipped-locked';
  readonly bytes?: number;
  readonly action: 'delete' | 'compress' | 'skip';
}

export interface StorageGcReport {
  readonly homeDir: string;
  readonly dryRun: boolean;
  readonly items: readonly StorageGcItem[];
  readonly freedBytes: number;
  readonly compressed: number;
  readonly deleted: number;
  readonly skipped: number;
}

const DEFAULT_IDLE_MS = 7 * 24 * 60 * 60 * 1000;

async function dirBytes(path: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) {
      total += await dirBytes(full);
      continue;
    }
    try {
      const info = await stat(full);
      total += info.size;
    } catch {
      // ignore
    }
  }
  return total;
}

async function isPathLocked(path: string): Promise<boolean> {
  try {
    const fh = await open(path, 'r+');
    await fh.close();
    return false;
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code)
        : '';
    return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES';
  }
}

async function mtimeMs(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return undefined;
  }
}

async function sessionIsActive(sessionDir: string, idleMs: number, now: number): Promise<boolean> {
  const stateM = await mtimeMs(join(sessionDir, 'state.json'));
  if (stateM !== undefined && now - stateM < idleMs) return true;
  // Any recent wire under agents/* keeps the session active.
  const agentsDir = join(sessionDir, 'agents');
  let entries;
  try {
    entries = await readdir(agentsDir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const agentDir = join(agentsDir, entry.name);
    for (const name of [WIRE_JSONL, WIRE_JSONL_GZ]) {
      const m = await mtimeMs(join(agentDir, name));
      if (m !== undefined && now - m < idleMs) return true;
    }
  }
  return false;
}

async function* walkAgentDirs(sessionsRoot: string): AsyncGenerator<string> {
  let workspaces;
  try {
    workspaces = await readdir(sessionsRoot, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ws of workspaces) {
    if (!ws.isDirectory()) continue;
    const wsDir = join(sessionsRoot, ws.name);
    let sessions;
    try {
      sessions = await readdir(wsDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const sess of sessions) {
      if (!sess.isDirectory() || !sess.name.startsWith('session_')) continue;
      const sessionDir = join(wsDir, sess.name);
      const agentsDir = join(sessionDir, 'agents');
      let agents;
      try {
        agents = await readdir(agentsDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const agent of agents) {
        if (!agent.isDirectory()) continue;
        yield join(agentsDir, agent.name);
      }
    }
  }
}

async function* walkSessionDirs(sessionsRoot: string): AsyncGenerator<string> {
  let workspaces;
  try {
    workspaces = await readdir(sessionsRoot, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ws of workspaces) {
    if (!ws.isDirectory()) continue;
    const wsDir = join(sessionsRoot, ws.name);
    let sessions;
    try {
      sessions = await readdir(wsDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const sess of sessions) {
      if (!sess.isDirectory() || !sess.name.startsWith('session_')) continue;
      yield join(wsDir, sess.name);
    }
  }
}

export async function collectStorageGarbage(options: StorageGcOptions): Promise<StorageGcReport> {
  const homeDir = options.homeDir;
  const dryRun = options.dryRun === true;
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const now = options.now ?? Date.now();
  const items: StorageGcItem[] = [];
  let freedBytes = 0;
  let compressed = 0;
  let deleted = 0;
  let skipped = 0;

  const sessionsRoot = join(homeDir, 'sessions');

  // Mark active sessions so we never touch their wires.
  const activeSessions = new Set<string>();
  for await (const sessionDir of walkSessionDirs(sessionsRoot)) {
    if (await sessionIsActive(sessionDir, idleMs, now)) {
      activeSessions.add(sessionDir);
      items.push({ path: sessionDir, kind: 'skipped-active', action: 'skip' });
      skipped += 1;
    }
  }

  if (options.compressIdleWires !== false) {
    for await (const agentDir of walkAgentDirs(sessionsRoot)) {
      const sessionDir = join(agentDir, '..', '..');
      // Normalize: agentDir = .../session_x/agents/agent_y
      const sessRoot = join(agentDir, '..', '..');
      let resolvedSession = sessRoot;
      try {
        // walk up two levels from agentDir
        resolvedSession = join(agentDir, '..', '..');
      } catch {
        // ignore
      }
      // Use path segments: agents parent is session
      const parts = agentDir.replace(/\\/g, '/').split('/');
      const agentsIdx = parts.lastIndexOf('agents');
      const sessionPath =
        agentsIdx > 0 ? parts.slice(0, agentsIdx).join('/') : resolvedSession;

      let isActive = false;
      for (const active of activeSessions) {
        if (sessionPath === active.replace(/\\/g, '/') || agentDir.startsWith(active)) {
          isActive = true;
          break;
        }
      }
      if (isActive) continue;

      const plain = join(agentDir, WIRE_JSONL);
      const plainM = await mtimeMs(plain);
      if (plainM === undefined) continue;
      if (now - plainM < idleMs) continue;

      if (await isPathLocked(plain)) {
        items.push({ path: plain, kind: 'skipped-locked', action: 'skip' });
        skipped += 1;
        continue;
      }

      const before = (await stat(plain).catch(() => undefined))?.size ?? 0;
      items.push({ path: plain, kind: 'wire-gzip', bytes: before, action: 'compress' });
      if (!dryRun) {
        const ok = await compressWireJsonl(agentDir);
        if (ok) {
          compressed += 1;
          const after = (await mtimeMs(join(agentDir, WIRE_JSONL_GZ))) !== undefined
            ? ((await stat(join(agentDir, WIRE_JSONL_GZ)).catch(() => undefined))?.size ?? 0)
            : 0;
          if (before > after) freedBytes += before - after;
        }
      }
    }
  }

  if (options.pruneCache !== false) {
    const cacheRoot = join(homeDir, 'cache');
    let cacheEntries;
    try {
      cacheEntries = await readdir(cacheRoot, { withFileTypes: true });
    } catch {
      cacheEntries = [];
    }
    for (const entry of cacheEntries) {
      // Prefer releases extract trees; also accept any top-level cache dir older than idle.
      const full = join(cacheRoot, entry.name);
      if (!entry.isDirectory()) continue;
      const m = await mtimeMs(full);
      if (m === undefined || now - m < idleMs) continue;
      const bytes = await dirBytes(full);
      items.push({ path: full, kind: 'cache', bytes, action: 'delete' });
      if (!dryRun) {
        await rm(full, { recursive: true, force: true });
        deleted += 1;
        freedBytes += bytes;
      }
    }
  }

  if (options.pruneWorktreeTmp !== false) {
    const wtRoot = worktreesRoot(homeDir);
    // Look for *.tmp debris under each worktree registry area and top-level tmp dirs.
    let wtEntries;
    try {
      wtEntries = await readdir(wtRoot, { withFileTypes: true });
    } catch {
      wtEntries = [];
    }
    for (const entry of wtEntries) {
      if (!entry.isDirectory()) continue;
      const full = join(wtRoot, entry.name);
      // Only reclaim names that look temporary / orphan extract folders.
      const looksTmp =
        entry.name.endsWith('.tmp') ||
        entry.name.startsWith('tmp-') ||
        entry.name.startsWith('.tmp');
      if (!looksTmp) continue;
      const m = await mtimeMs(full);
      if (m === undefined || now - m < idleMs) continue;
      const bytes = await dirBytes(full);
      items.push({ path: full, kind: 'worktree-tmp', bytes, action: 'delete' });
      if (!dryRun) {
        await rm(full, { recursive: true, force: true });
        deleted += 1;
        freedBytes += bytes;
      }
    }
  }

  return {
    homeDir,
    dryRun,
    items,
    freedBytes,
    compressed,
    deleted,
    skipped,
  };
}

export interface StorageBytesReport {
  readonly homeDir: string;
  readonly homeBytes: number;
  readonly sessionsBytes: number;
  readonly cacheBytes: number;
  readonly logsBytes: number;
}

export async function measureStorageBytes(homeDir: string): Promise<StorageBytesReport> {
  const homeBytes = await dirBytes(homeDir);
  const sessionsBytes = await dirBytes(join(homeDir, 'sessions'));
  const cacheBytes = await dirBytes(join(homeDir, 'cache'));
  const logsBytes = await dirBytes(join(homeDir, 'logs'));
  return { homeDir, homeBytes, sessionsBytes, cacheBytes, logsBytes };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
