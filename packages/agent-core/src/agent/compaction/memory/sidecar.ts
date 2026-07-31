import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MAX_SIDECARS_PER_KIND = 32;

/**
 * Persist a compaction sidecar file (for example the full archive-id or
 * evidence-id list) under `dir`, keeping at most MAX_SIDECARS_PER_KIND files
 * per kind (LRU by mtime). Returns the written path, or undefined when the
 * file could not be written; callers fall back to inline overflow notes.
 */
export function persistCompactionSidecar(
  dir: string,
  kind: string,
  body: string,
): string | undefined {
  try {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${kind}-${Date.now().toString(36)}.txt`);
    writeFileSync(file, body);
    pruneCompactionSidecars(dir, kind);
    return file;
  } catch {
    return undefined;
  }
}

function pruneCompactionSidecars(dir: string, kind: string): void {
  try {
    const prefix = `${kind}-`;
    const entries = readdirSync(dir)
      .filter((name) => name.startsWith(prefix) && name.endsWith('.txt'))
      .map((name) => {
        try {
          return { name, mtimeMs: statSync(join(dir, name)).mtimeMs };
        } catch {
          return undefined;
        }
      })
      .filter((entry): entry is { name: string; mtimeMs: number } => entry !== undefined)
      .toSorted((a, b) => b.mtimeMs - a.mtimeMs);
    for (const entry of entries.slice(MAX_SIDECARS_PER_KIND)) {
      try {
        rmSync(join(dir, entry.name));
      } catch {
        // Best effort; a concurrent reader may already have removed it.
      }
    }
  } catch {
    // Best effort.
  }
}
