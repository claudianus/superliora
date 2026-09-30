/**
 * The sync durable write must survive the same transient Windows lock as its
 * async twin: `renameSync` is MoveFileEx, which fails with EPERM while any
 * handle to the target is open (antivirus, an indexer, a concurrent reader).
 * Without a retry the write aborts and the staging file is cleaned up, so the
 * update is silently lost.
 *
 * Windows-only behavior is driven here by mocking the platform and injecting
 * EPERM into `renameSync`; the host is the thing being taken out of the test.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const savedPlatform = process.platform;

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: savedPlatform, configurable: true });
  vi.doUnmock('node:fs');
  vi.resetModules();
});

async function loadFsWithEpermRename(failures: number): Promise<{
  writeFileAtomicSync: (path: string, content: string) => void;
  remainingFailures: () => number;
  renameAttempts: () => number;
}> {
  let remaining = failures;
  let attempts = 0;
  vi.resetModules();
  vi.doMock('node:fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs')>();
    return {
      ...actual,
      default: actual,
      renameSync: (from: Parameters<typeof actual.renameSync>[0], to: Parameters<typeof actual.renameSync>[1]) => {
        attempts += 1;
        if (remaining > 0) {
          remaining -= 1;
          const error = new Error('EPERM: operation not permitted, rename') as NodeJS.ErrnoException;
          error.code = 'EPERM';
          throw error;
        }
        return actual.renameSync(from, to);
      },
    };
  });
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  const mod = await import('#/utils/fs');
  return {
    writeFileAtomicSync: mod.writeFileAtomicSync,
    remainingFailures: () => remaining,
    renameAttempts: () => attempts,
  };
}

describe('writeFileAtomicSync under a Windows lock', () => {
  it('retries a transient EPERM and lands the new content', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'liora-atomic-sync-'));
    const file = join(dir, 'state.json');
    writeFileSync(file, 'old');
    try {
      const { writeFileAtomicSync, remainingFailures, renameAttempts } =
        await loadFsWithEpermRename(2);

      writeFileAtomicSync(file, 'new');

      expect(remainingFailures()).toBe(0);
      expect(renameAttempts()).toBe(3);
      expect(readFileSync(file, 'utf8')).toBe('new');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});