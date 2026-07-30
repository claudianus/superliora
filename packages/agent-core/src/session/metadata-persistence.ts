/**
 * Session metadata persistence — extracted from Session class.
 *
 * Handles atomic read/write of `state.json` with backup rotation and
 * crash-recovery fallback logic.
 */

import { join } from 'pathe';
import { KaosFileNotFoundError, type Kaos } from '@superliora/kaos';

import type { Logger } from '#/logging/types';
import type { SessionMeta } from './session-types';

export interface MetadataPersistenceOptions {
  readonly sessionHomedir: string;
  readonly kaos: Kaos;
  readonly log: Logger;
}

export class SessionMetadataPersistence {
  private writePromise = Promise.resolve();

  constructor(private readonly opts: MetadataPersistenceOptions) {}

  private get metadataPath(): string {
    return join(this.opts.sessionHomedir, 'state.json');
  }

  private get backupPath(): string {
    return join(this.opts.sessionHomedir, 'state.json.bak');
  }

  private get tempPath(): string {
    return join(this.opts.sessionHomedir, 'state.json.tmp');
  }

  /**
   * Atomically writes session metadata using a temp-file + rename strategy.
   * A crash between writing and renaming leaves `state.json` at its previous
   * (complete) value rather than truncated mid-write.
   */
  write(metadata: SessionMeta): Promise<void> {
    const text = JSON.stringify(metadata, null, 2);
    const { kaos, sessionHomedir } = this.opts;
    const tmp = this.tempPath;
    const dest = this.metadataPath;
    const backup = this.backupPath;
    const doWrite = async () => {
      await kaos.mkdir(sessionHomedir, { parents: true, existOk: true });
      await kaos.writeText(tmp, text);
      // Preserve the prior good file as `.bak` so a corrupt future read can
      // fall back to it.
      let hadExisting = false;
      try {
        await kaos.stat(dest);
        hadExisting = true;
      } catch {
        hadExisting = false;
      }
      if (hadExisting) {
        await kaos.rename(dest, backup).catch(() => {});
      }
      await kaos.rename(tmp, dest);
    };
    this.writePromise = this.writePromise.then(doWrite, doWrite);
    return this.writePromise;
  }

  /**
   * Reads session metadata with crash-recovery fallback:
   * state.json → state.json.bak → default metadata.
   */
  async read(defaultMetadata: SessionMeta): Promise<SessionMeta> {
    const { kaos, log } = this.opts;
    const dest = this.metadataPath;
    const backup = this.backupPath;
    const parse = (text: string): SessionMeta => JSON.parse(text) as SessionMeta;

    try {
      const text = await kaos.readText(dest);
      return parse(text);
    } catch (error) {
      const isMissing = isNotFoundError(error);
      if (isMissing || !isNotFoundError(error)) {
        try {
          const backupText = await kaos.readText(backup);
          const metadata = parse(backupText);
          if (!isMissing) {
            log.warn('state.json was corrupt; recovered session metadata from state.json.bak', {
              error: error instanceof Error ? error.message : String(error),
            });
          } else {
            log.warn('state.json missing; recovered session metadata from state.json.bak');
          }
          return metadata;
        } catch {
          // Backup also missing/unreadable — fall through to default below.
        }
      }
      if (!isMissing) {
        log.warn(
          'state.json and state.json.bak are both unreadable; starting with default session metadata',
          { error: error instanceof Error ? error.message : String(error) },
        );
      }
      return defaultMetadata;
    }
  }

  /** Waits for any pending write to complete. */
  async flush(): Promise<void> {
    await this.writePromise;
  }
}

/**
 * Return true iff `error` represents a "file does not exist" failure from
 * either the local Kaos (raw `node:fs` `ENOENT`) or the SSH Kaos
 * (`KaosFileNotFoundError`).
 */
function isNotFoundError(error: unknown): boolean {
  if (error instanceof KaosFileNotFoundError) return true;
  if (error !== null && typeof error === 'object' && 'code' in error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT';
  }
  return false;
}
