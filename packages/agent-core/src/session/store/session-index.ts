import { appendFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'pathe';

export interface SessionIndexEntry {
  readonly sessionId: string;
  readonly sessionDir: string;
  readonly workDir: string;
}

// Per-homeDir append chain. Within one process, concurrent index appends are
// serialized so two lines can never be interleaved at the filesystem layer.
// Cross-process, a single short line written with O_APPEND is atomic on POSIX
// (well under PIPE_BUF), so this closes the realistic same-process tearing gap
// without taking a file lock. A failed append is reported to its caller but does
// not poison the chain for later appends.
const appendQueues = new Map<string, Promise<void>>();

export function sessionIndexPath(homeDir: string): string {
  return join(homeDir, 'sessions', 'index.jsonl');
}

/** Home-root leftover from before the index moved under `sessions/`. */
export function sessionIndexLegacyPath(homeDir: string): string {
  return join(homeDir, 'session_index.jsonl');
}

export async function appendSessionIndexEntry(
  homeDir: string,
  entry: SessionIndexEntry,
): Promise<void> {
  const indexPath = sessionIndexPath(homeDir);
  const line = `${JSON.stringify(entry)}\n`;
  const previous = appendQueues.get(homeDir) ?? Promise.resolve();
  const next = previous.then(async () => {
    await mkdir(dirname(indexPath), { recursive: true, mode: 0o700 });
    await appendFile(indexPath, line, 'utf-8');
  });
  appendQueues.set(homeDir, next.then(() => undefined, () => undefined));
  return next;
}

export async function readSessionIndex(
  homeDir: string,
  sessionsDir: string,
): Promise<Map<string, SessionIndexEntry>> {
  const result = new Map<string, SessionIndexEntry>();
  // Legacy first so a newer `sessions/index.jsonl` line wins for the same id.
  ingestIndexText(result, await readIndexText(sessionIndexLegacyPath(homeDir)), sessionsDir);
  ingestIndexText(result, await readIndexText(sessionIndexPath(homeDir)), sessionsDir);
  return result;
}

/**
 * True when the on-disk index is missing or empty. Used by `SessionStore`
 * callers to decide whether a self-healing `reindex()` scan is worth running
 * — a lost index file (crash during the old unlink+rename window) otherwise
 * hides every session from `listSessions` until the server happens to boot.
 */
export async function isSessionIndexEmpty(homeDir: string): Promise<boolean> {
  const indexPath = sessionIndexPath(homeDir);
  const legacyPath = sessionIndexLegacyPath(homeDir);
  for (const path of [indexPath, legacyPath]) {
    try {
      if ((await readFile(path, 'utf-8')).trim().length > 0) return false;
    } catch {
      // Missing file counts as empty for that path.
    }
  }
  return true;
}

/** Rewrite `sessions/index.jsonl` to last-wins lines and drop the leftover home-root index. */
export async function writeSessionIndexSnapshot(
  homeDir: string,
  entries: Iterable<SessionIndexEntry>,
): Promise<void> {
  const indexPath = sessionIndexPath(homeDir);
  const tmpPath = `${indexPath}.tmp`;
  const lines = [...entries]
    .map((entry) =>
      JSON.stringify({
        sessionId: entry.sessionId,
        sessionDir: entry.sessionDir,
        workDir: entry.workDir,
      }),
    )
    .join('\n');
  const body = lines.length === 0 ? '' : `${lines}\n`;
  const previous = appendQueues.get(homeDir) ?? Promise.resolve();
  const next = previous.then(async () => {
    await mkdir(dirname(indexPath), { recursive: true, mode: 0o700 });
    await writeFile(tmpPath, body, 'utf-8');
    try {
      // Rename directly over the target — atomic on POSIX and Windows. The
      // old unlink-then-rename left a crash window where the index did not
      // exist at all, losing every session entry to a hard kill.
      await rename(tmpPath, indexPath);
    } catch (error) {
      await unlink(tmpPath).catch(() => undefined);
      throw error;
    }
    await unlink(sessionIndexLegacyPath(homeDir)).catch(() => undefined);
  });
  appendQueues.set(homeDir, next.then(() => undefined, () => undefined));
  return next;
}

export async function compactSessionIndex(homeDir: string, sessionsDir: string): Promise<number> {
  const index = await readSessionIndex(homeDir, sessionsDir);
  await writeSessionIndexSnapshot(homeDir, index.values());
  return index.size;
}

export async function upsertSessionIndexEntry(
  homeDir: string,
  sessionsDir: string,
  entry: SessionIndexEntry,
): Promise<void> {
  const index = await readSessionIndex(homeDir, sessionsDir);
  index.set(entry.sessionId, {
    sessionId: entry.sessionId,
    sessionDir: resolve(entry.sessionDir),
    workDir: entry.workDir,
  });
  await writeSessionIndexSnapshot(homeDir, index.values());
}

async function readIndexText(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return '';
  }
}

function ingestIndexText(
  result: Map<string, SessionIndexEntry>,
  raw: string,
  sessionsDir: string,
): void {
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const entry = parseIndexLine(trimmed);
    if (entry === undefined) continue;
    const sessionDir = resolve(entry.sessionDir);
    if (!isAbsolute(entry.sessionDir)) continue;
    if (!isPathInside(sessionsDir, sessionDir)) continue;
    if (basename(sessionDir) !== entry.sessionId) continue;
    // `workDir` is no longer authoritative: summaries prefer the workDir stored
    // in each session's self-describing state.json, so a stale or relocated
    // index workDir must not drop an otherwise valid entry.
    result.set(entry.sessionId, {
      sessionId: entry.sessionId,
      sessionDir,
      workDir: entry.workDir,
    });
  }
}

function parseIndexLine(line: string): SessionIndexEntry | undefined {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const entry = parsed as Partial<SessionIndexEntry>;
    if (
      typeof entry.sessionId !== 'string' ||
      typeof entry.sessionDir !== 'string' ||
      typeof entry.workDir !== 'string'
    ) {
      return undefined;
    }
    return {
      sessionId: entry.sessionId,
      sessionDir: entry.sessionDir,
      workDir: entry.workDir,
    };
  } catch {
    return undefined;
  }
}

function isPathInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}
