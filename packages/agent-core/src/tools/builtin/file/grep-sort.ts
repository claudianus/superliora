import type { Kaos } from '@superliora/kaos';

import { GrepAbortedError, type ParsedGrepLine } from './grep-types';

const MTIME_STAT_CONCURRENCY = 32;

export async function sortFilesWithMatchesByMtime(
  lines: readonly ParsedGrepLine[],
  kaos: Kaos,
  signal: AbortSignal,
): Promise<ParsedGrepLine[]> {
  const entries = await mapWithConcurrency(
    lines,
    MTIME_STAT_CONCURRENCY,
    signal,
    async (line, index) => {
      const path =
        line.kind === 'record' ? line.filePath : line.kind === 'legacy' ? line.text : undefined;
      let mtime = 0;
      if (path !== undefined) {
        try {
          mtime = (await kaos.stat(path)).stMtime ?? 0;
        } catch {
          // Keep stat failures visible; use mtime=0 so they sort after known files.
        }
      }
      return { line, mtime, index };
    },
  );
  entries.sort((a, b) => b.mtime - a.mtime || a.index - b.index);
  return entries.map((entry) => entry.line);
}

async function mapWithConcurrency<T, U>(
  items: readonly T[],
  concurrency: number,
  signal: AbortSignal,
  mapper: (item: T, index: number) => Promise<U>,
): Promise<U[]> {
  if (signal.aborted) throw new GrepAbortedError();
  if (items.length === 0) return [];

  const results: U[] = [];
  results.length = items.length;
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        if (signal.aborted) return;
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        results[index] = await mapper(items[index] as T, index);
      }
    }),
  );
  if (signal.aborted) throw new GrepAbortedError();
  return results;
}
