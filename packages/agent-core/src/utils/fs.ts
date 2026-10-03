/**
 * Low-level POSIX durability primitives.
 *
 * Two concerns that every durable write must handle:
 *   1. file *contents* — solved by `fh.sync()` after the write
 *   2. directory *entries* — solved by opening the parent directory and
 *      calling `fh.sync()` on the directory handle
 *
 * `fh.sync()` on a file does NOT guarantee that the directory entry
 * pointing at that file has been committed. On POSIX a crash between
 * the file-content fsync and the parent-directory fsync can leave the
 * file's bytes on disk with no visible name. The primary durable path
 * is POSIX; Windows is best-effort — NTFS's MoveFileEx commits the
 * dirent inside the file fsync, so a separate directory fsync is a
 * no-op (and EISDIR-fails on `open(dir, 'r')`).
 */
import { randomBytes } from 'node:crypto';
import { closeSync, fsyncSync, openSync } from 'node:fs';
import * as nodeFs from 'node:fs';
import { open, rename, unlink } from 'node:fs/promises';
import { dirname } from 'pathe';

/**
 * Open a directory read-only and fsync it, then close. Used to make a
 * freshly-created or renamed file's directory entry durable.
 *
 * Windows: noop. `open(dir, 'r')` throws EISDIR, and NTFS commits the
 * dirent transaction inside the file fsync anyway — the separate dir
 * fsync would buy nothing even if we could issue it.
 */
export async function syncDir(dirPath: string): Promise<void> {
  if (process.platform === 'win32') return;
  const dirFh = await open(dirPath, 'r');
  try {
    await dirFh.sync();
  } finally {
    await dirFh.close();
  }
}
/**
 * Synchronous variant of `syncDir`. Used by batched drain paths where a
 * single timer fire needs to be an atomic event-loop step. Windows
 * mirrors the async variant — noop.
 */
export function syncDirSync(dirPath: string): void {
  if (process.platform === 'win32') return;
  const fd = openSync(dirPath, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
/**
 * Write `content` to `filePath` atomically and durably:
 *   1. Write content to `<filePath>.tmp`, fsync it, close it.
 *   2. Rename `<filePath>.tmp` → `filePath` (atomic on POSIX).
 *   3. fsync the parent directory so the rename is durable.
 *
 * On any failure before the rename the `.tmp` file is removed so the
 * caller's directory is not left with a half-written leftover. A
 * failure *after* the rename (i.e. in the parent-directory fsync) is
 * surfaced to the caller — the content is already in place, but
 * durability is not guaranteed.
 */
/**
 * Rename a staged temp file over its target, tolerating a transient Windows
 * lock without ever opening a window where the target does not exist.
 *
 * On Windows `fs.rename` maps to MoveFileEx and fails with EPERM while any
 * handle to the target is open (antivirus, an indexer, a concurrent reader).
 * The obvious workaround — unlink the target first — is a data-loss window: a
 * crash between the unlink and the rename destroys the target outright, which
 * defeats the point of an atomic write, and a concurrent reader sees ENOENT on
 * a file that should always be there. So retry the rename first and only
 * pre-unlink after the retries are exhausted.
 */
async function renameReplacingTarget(tmpPath: string, filePath: string): Promise<void> {
  if (process.platform !== 'win32') {
    await rename(tmpPath, filePath);
    return;
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await rename(tmpPath, filePath);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
      // Handles come and go; a short bounded backoff clears nearly all of them.
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 25 * (attempt + 1));
      });
    }
  }
  try {
    await unlink(filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw error;
  }
  await rename(tmpPath, filePath);
}

/** Staging path unique to this process and call, so writers never collide. */
function stagingPathFor(filePath: string): string {
  return `${filePath}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`;
}

/**
 * Blocking backoff for the synchronous rename retry below. `Atomics.wait` on a
 * throwaway shared buffer parks the thread without a busy loop (Node allows it
 * on the main thread).
 */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Synchronous twin of {@link renameReplacingTarget}. Windows `renameSync` maps
 * to MoveFileEx and fails with EPERM while any handle to the target is open
 * (antivirus, an indexer, a concurrent reader), so a transient lock must not
 * abort the write — the caller's staging file is cleaned up and the update is
 * simply lost.
 */
function renameReplacingTargetSync(tmpPath: string, targetPath: string): void {
  if (process.platform !== 'win32') {
    nodeFs.renameSync(tmpPath, targetPath);
    return;
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      nodeFs.renameSync(tmpPath, targetPath);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
      // Handles come and go; a short bounded backoff clears nearly all of them.
      sleepSync(25 * (attempt + 1));
    }
  }
  try {
    nodeFs.unlinkSync(targetPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw error;
  }
  nodeFs.renameSync(tmpPath, targetPath);
}

/**
 * Durably write a file: stage a uniquely-named temp, fsync it, rename it over
 * the target, then fsync the parent directory.
 */
export async function writeFileAtomicDurable(
  filePath: string,
  content: string | Uint8Array,
): Promise<void> {
  // A fixed `.tmp` suffix let two concurrent writers truncate each other's
  // staging file and lose one write (Conductor fan-out writing the worktree
  // registry is the real caller that does this).
  const tmpPath = stagingPathFor(filePath);
  let renamed = false;
  try {
    const fh = await open(tmpPath, 'w');
    try {
      await fh.writeFile(content);
      await fh.sync();
    } finally {
      await fh.close();
    }
    await renameReplacingTarget(tmpPath, filePath);
    renamed = true;
    await syncDir(dirname(filePath));
  } finally {
    if (!renamed) {
      // Best-effort cleanup of the staging file if we never got to the
      // rename. Swallow ENOENT because the file may not exist (open
      // itself failed) or may already have been unlinked.
      try {
        await unlink(tmpPath);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Synchronously write a file atomically and durably: stage a uniquely-
 * named temp file, fsync it, rename it into place, then fsync the parent
 * directory. A crash mid-write cannot leave the target truncated.
 */
export function writeFileAtomicSync(targetPath: string, content: string): void {
  const directory = dirname(targetPath);
  nodeFs.mkdirSync(directory, { recursive: true });
  const hex = randomBytes(4).toString('hex');
  const tmpPath = `${targetPath}.tmp.${process.pid}.${hex}`;
  let renamed = false;
  try {
    const fd = openSync(tmpPath, 'w');
    try {
      nodeFs.writeFileSync(fd, content, 'utf8');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameReplacingTargetSync(tmpPath, targetPath);
    renamed = true;
    // Commit the directory entry so the rename survives a power loss.
    if (process.platform !== 'win32') {
      const dirFd = openSync(directory, 'r');
      try {
        fsyncSync(dirFd);
      } finally {
        closeSync(dirFd);
      }
    }
  } finally {
    if (!renamed) {
      try {
        nodeFs.unlinkSync(tmpPath);
      } catch {
        // ignore — temp may not exist if open itself failed
      }
    }
  }
}

/**
 * atomicWrite — cross-platform atomic file replacement.
 *
 * Guarantees that readers never observe a half-written file:
 *   1. Write content to a uniquely-named temp file in the same directory.
 *   2. fsync the temp file so the bytes are durable.
 *   3. rename(tmp, target) — atomic on POSIX.
 *   4. On any failure before the rename, unlink the temp file (best effort).
 *
 * Does NOT fsync the parent directory; callers that need full POSIX
 * crash durability should `await syncDir(dirname(path))` after this call.
 *
 * NOT suitable for append-only paths (wire.jsonl). Those are handled by
 * `FileSystemAgentRecordPersistence.drainBatch`, which appends at the current
 * file position and fsyncs the fd.
 */

/**
 * fsync a file descriptor using the callback-based `fs.fsync`. We go
 * through the module namespace (`nodeFs.fsync`) rather than
 * `FileHandle.sync()` so vitest's `vi.spyOn(fs, 'fsync')` can
 * intercept the call for fault-injection tests.
 */
function syncFd(fd: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    nodeFs.fsync(fd, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

/**
 * Atomically write `content` to `filePath`. If the target already exists
 * it is replaced; if it does not exist it is created.
 *
 * @param filePath — absolute or relative path to the target file.
 * @param content  — string or binary payload to write.
 * @param _syncOverride — test seam: override the fsync implementation for
 *   fault injection. Production callers must never supply this.
 */
export async function atomicWrite(
  filePath: string,
  content: string | Uint8Array,
  _syncOverride?: (fd: number) => Promise<void>,
): Promise<void> {
  const tmpPath = stagingPathFor(filePath);
  let renamed = false;
  try {
    const fh = await open(tmpPath, 'w');
    try {
      await fh.writeFile(content);
      await (_syncOverride ?? syncFd)(fh.fd);
    } finally {
      await fh.close();
    }
    await renameReplacingTarget(tmpPath, filePath);
    renamed = true;
  } finally {
    if (!renamed) {
      try {
        await unlink(tmpPath);
      } catch {
        /* ignore — file may not exist if open itself failed */
      }
    }
  }
}
