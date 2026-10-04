import { link, mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CoordinatorProjection, CoordinatorStore } from './contracts';

export interface CoordinatorLockOwner { pid: number; token: string; createdAt: number }

async function readOwner(path: string): Promise<CoordinatorLockOwner> {
  const owner: unknown = JSON.parse(await readFile(`${path}.lock`, 'utf8'));
  if (typeof owner !== 'object' || owner === null || !('pid' in owner) || !('token' in owner) || !('createdAt' in owner) ||
    !Number.isInteger(owner.pid) || (owner.pid as number) <= 0 || typeof owner.token !== 'string' || typeof owner.createdAt !== 'number') throw new Error('Invalid coordinator lock; manual investigation required');
  return owner as CoordinatorLockOwner;
}

const isDead = (pid: number): boolean => {
  try { process.kill(pid, 0); return false; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
    throw error;
  }
};

/**
 * Exclusive recovery marker. It is published with its holder PID in one atomic
 * link, so a marker left by a crashed recovery is always attributable and can
 * be reclaimed once that PID is gone; a live or unknown holder fails closed.
 */
async function acquireRecovery(path: string): Promise<string> {
  const marker = `${path}.recovery`;
  const token = randomUUID();
  const staged = `${marker}.${token}.tmp`;
  await writeFile(staged, JSON.stringify({ pid: process.pid, token }), { flag: 'wx', mode: 0o600 });
  try {
    for (let attempt = 0; ; attempt++) {
      try { await link(staged, marker); return token; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || attempt > 0) throw error;
        const holder: unknown = JSON.parse(await readFile(marker, 'utf8'));
        if (typeof holder !== 'object' || holder === null || !('pid' in holder) || !Number.isInteger(holder.pid) || (holder.pid as number) <= 0) {
          throw new Error('Invalid coordinator recovery marker; manual investigation required', { cause: error });
        }
        if (!isDead(holder.pid as number)) throw new Error('Coordinator recovery already in progress', { cause: error });
        await unlink(marker);
      }
    }
  } finally { await unlink(staged); }
}

async function releaseRecovery(path: string, token: string): Promise<void> {
  const marker = `${path}.recovery`;
  const holder = JSON.parse(await readFile(marker, 'utf8')) as { token?: unknown };
  if (holder.token === token) await unlink(marker);
}

export class FileCoordinatorStore implements CoordinatorStore {
  private closed = false;
  /** Set when a save failed after its rename may have published the projection. */
  private uncertainCommit: unknown;
  private constructor(private readonly path: string, private readonly token: string) {}

  static async open(path: string): Promise<FileCoordinatorStore> {
    await mkdir(dirname(path), { recursive: true });
    const token = randomUUID();
    const lock = await open(`${path}.lock`, 'wx', 0o600);
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid, token, createdAt: Date.now() }));
      await lock.sync();
    } catch (error) {
      await unlink(`${path}.lock`);
      throw error;
    } finally { await lock.close(); }
    return new FileCoordinatorStore(path, token);
  }

  static async inspectOwner(path: string): Promise<CoordinatorLockOwner> { return readOwner(path); }

  /** Explicit operator reconciliation only; PID reuse / unknown liveness fail closed. */
  static async recover(path: string, options: {
    expectedToken: string;
    confirmResourcesReconciled: (owner: CoordinatorLockOwner) => boolean | Promise<boolean>;
  }): Promise<FileCoordinatorStore> {
    const recovery = await acquireRecovery(path);
    try {
      const owner = await readOwner(path);
      if (owner.token !== options.expectedToken) throw new Error('Coordinator recovery token changed');
      if (!isDead(owner.pid)) throw new Error('Coordinator owner may still be live; refusing recovery');
      if (!await options.confirmResourcesReconciled(structuredClone(owner))) throw new Error('Coordinator execution resources have not been reconciled');
      if ((await readOwner(path)).token !== owner.token) throw new Error('Coordinator lock changed during reconciliation');
      await unlink(`${path}.lock`);
      return await FileCoordinatorStore.open(path);
    } finally {
      await releaseRecovery(path, recovery);
    }
  }

  async load(): Promise<CoordinatorProjection | undefined> {
    await this.assertOwner();
    try { return JSON.parse(await readFile(this.path, 'utf8')) as CoordinatorProjection; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async save(projection: CoordinatorProjection): Promise<void> {
    await this.assertOwner();
    if (this.uncertainCommit !== undefined) throw new Error('Coordinator store has an unacknowledged commit; reopen to reconcile', { cause: this.uncertainCommit });
    const temp = `${this.path}.${randomUUID()}.tmp`;
    try {
      const file = await open(temp, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(projection)); await file.sync(); }
      finally { await file.close(); }
      await this.assertOwner();
      await rename(temp, this.path);
      try {
        if (process.platform !== 'win32') {
          const directory = await open(dirname(this.path), 'r');
          try { await directory.sync(); } finally { await directory.close(); }
        }
      } catch (error) {
        // The rename already installed this projection, but the caller will treat
        // the save as failed and keep its previous in-memory state. Fail closed so
        // a later save cannot silently overwrite the published update; reopening
        // reloads the on-disk projection.
        this.uncertainCommit = error;
        throw error;
      }
    } finally {
      await unlink(temp).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    await this.assertOwner();
    await unlink(`${this.path}.lock`);
    this.closed = true;
  }

  private async assertOwner(): Promise<void> {
    if (this.closed) throw new Error('Coordinator store is closed');
    if ((await readOwner(this.path)).token !== this.token) throw new Error('Coordinator lock ownership changed');
  }
}
