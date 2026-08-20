/**
 * Close tracked SQLite handles that live under a path about to be deleted,
 * then retry Windows lock errors. Loaded as a vitest setupFile so every
 * `rmSync` / `fs.promises.rm` of a temp home succeeds after the test body.
 *
 * Tests `import { rmSync } from 'node:fs'`. Mutating the CJS export is not
 * enough — `syncBuiltinESMExports()` refreshes the ESM named bindings.
 */
import { createRequire, syncBuiltinESMExports } from 'node:module';

import { closeTrackedSqliteHandlesUnder } from '../src/runtime/sqlite-handles';

const fs = createRequire(import.meta.url)('node:fs') as typeof import('node:fs');

const MAX_RM_ATTEMPTS = 24;
const RM_RETRY_BASE_MS = 50;

function isLockError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'EPERM' || code === 'EBUSY' || code === 'ENOTEMPTY' || code === 'EACCES';
}

function syncSleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function wrapSyncRm(
  orig: (path: fs.PathLike, options?: fs.RmOptions) => void,
): (path: fs.PathLike, options?: fs.RmOptions) => void {
  return (path, options) => {
    const target = String(path);
    closeTrackedSqliteHandlesUnder(target);
    let last: unknown;
    for (let attempt = 0; attempt < MAX_RM_ATTEMPTS; attempt += 1) {
      try {
        orig(path, options);
        return;
      } catch (error) {
        last = error;
        if (!isLockError(error) || attempt === MAX_RM_ATTEMPTS - 1) throw error;
        syncSleep(RM_RETRY_BASE_MS * (attempt + 1));
        closeTrackedSqliteHandlesUnder(target);
      }
    }
    throw last;
  };
}

function wrapSyncUnlink(orig: (path: fs.PathLike) => void): (path: fs.PathLike) => void {
  return (path) => {
    const target = String(path);
    closeTrackedSqliteHandlesUnder(target);
    let last: unknown;
    for (let attempt = 0; attempt < MAX_RM_ATTEMPTS; attempt += 1) {
      try {
        orig(path);
        return;
      } catch (error) {
        last = error;
        if (!isLockError(error) || attempt === MAX_RM_ATTEMPTS - 1) throw error;
        syncSleep(RM_RETRY_BASE_MS * (attempt + 1));
        closeTrackedSqliteHandlesUnder(target);
      }
    }
    throw last;
  };
}

function wrapAsyncRm(
  orig: (path: fs.PathLike, options?: fs.RmOptions) => Promise<void>,
): (path: fs.PathLike, options?: fs.RmOptions) => Promise<void> {
  return async (path, options) => {
    const target = String(path);
    closeTrackedSqliteHandlesUnder(target);
    let last: unknown;
    for (let attempt = 0; attempt < MAX_RM_ATTEMPTS; attempt += 1) {
      try {
        await orig(path, options);
        return;
      } catch (error) {
        last = error;
        if (!isLockError(error) || attempt === MAX_RM_ATTEMPTS - 1) throw error;
        await new Promise((resolve) => setTimeout(resolve, RM_RETRY_BASE_MS * (attempt + 1)));
        closeTrackedSqliteHandlesUnder(target);
      }
    }
    throw last;
  };
}

function wrapAsyncUnlink(orig: (path: fs.PathLike) => Promise<void>): (path: fs.PathLike) => Promise<void> {
  return async (path) => {
    const target = String(path);
    closeTrackedSqliteHandlesUnder(target);
    let last: unknown;
    for (let attempt = 0; attempt < MAX_RM_ATTEMPTS; attempt += 1) {
      try {
        await orig(path);
        return;
      } catch (error) {
        last = error;
        if (!isLockError(error) || attempt === MAX_RM_ATTEMPTS - 1) throw error;
        await new Promise((resolve) => setTimeout(resolve, RM_RETRY_BASE_MS * (attempt + 1)));
        closeTrackedSqliteHandlesUnder(target);
      }
    }
    throw last;
  };
}

fs.rmSync = wrapSyncRm(fs.rmSync.bind(fs));
fs.unlinkSync = wrapSyncUnlink(fs.unlinkSync.bind(fs));
fs.promises.rm = wrapAsyncRm(fs.promises.rm.bind(fs.promises));
fs.promises.unlink = wrapAsyncUnlink(fs.promises.unlink.bind(fs.promises));
syncBuiltinESMExports();
