/**
 * Track open `node:sqlite` DatabaseSync handles so tests (and shutdown)
 * can release WAL/SHM locks before deleting a temp home on Windows.
 *
 * Unlinking an open SQLite file succeeds on POSIX and fails with EPERM/EBUSY
 * on Windows. Closing first is the portable contract.
 */
import { isAbsolute, relative, resolve } from 'node:path';

interface TrackedHandle {
  readonly path: string;
  close(): void;
}

const OPEN = new Set<TrackedHandle>();

export function trackSqliteDatabase<T extends { close(): void }>(path: string, db: T): T {
  let closed = false;
  const handle: TrackedHandle = {
    path,
    close() {
      if (closed) return;
      closed = true;
      OPEN.delete(handle);
      db.close();
    },
  };
  OPEN.add(handle);
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === 'close') {
        return () => {
          handle.close();
        };
      }
      const value = Reflect.get(target, prop, receiver) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

export function closeTrackedSqliteHandlesUnder(target: string): void {
  const snapshot = Array.from(OPEN);
  for (const handle of snapshot) {
    if (handleCoversPath(handle.path, target)) {
      try {
        handle.close();
      } catch {
        // Already closed or a corrupt handle — deletion can still proceed.
      }
    }
  }
}

function stripExtendedWinPath(path: string): string {
  return path.replace(/^\\\\\?\\/, '');
}

function handleCoversPath(handlePath: string, target: string): boolean {
  if (handlePath === ':memory:' || target === ':memory:') {
    return handlePath === target;
  }
  const handle = resolve(stripExtendedWinPath(handlePath));
  const dest = resolve(stripExtendedWinPath(target));
  if (pathsEqual(handle, dest)) return true;
  if (dest.startsWith(`${handle}-`)) return true;
  const rel = relative(dest, handle);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

function pathsEqual(left: string, right: string): boolean {
  if (process.platform === 'win32') {
    return left.toLowerCase() === right.toLowerCase();
  }
  return left === right;
}
