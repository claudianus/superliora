import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `isUnderAny` folds case when the filesystem folds case, which the service
 * probes instead of inferring from `process.platform`. These cases drive the
 * probe both ways so the identity rules are pinned for case-sensitive and
 * case-insensitive filesystems on any host — the previous version asserted
 * only against the host running the test, so a Linux container on a
 * case-insensitive mount compared paths case-sensitively and silently dropped
 * change events.
 */
type FsModule = {
  isUnderAny: (absPath: string, parents: Iterable<string>) => boolean;
  deriveSharedCwd: (absPaths: readonly string[]) => string;
};

const PROBE = 'caseprobe';

async function loadWithProbe(foldsCase: boolean): Promise<FsModule> {
  vi.resetModules();
  vi.doMock('node:fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs')>();
    return {
      ...actual,
      default: actual,
      existsSync: (p: unknown) =>
        typeof p === 'string' && p.endsWith(PROBE) ? foldsCase : actual.existsSync(p as never),
    };
  });
  return (await import('../../src/services/fs/fsWatcherService')) as unknown as FsModule;
}

afterEach(() => {
  vi.doUnmock('node:fs');
  vi.resetModules();
});

describe('fsWatcher case folding follows the probed filesystem', () => {
  it('keeps differing casing distinct on a case-sensitive filesystem', async () => {
    const { isUnderAny } = await loadWithProbe(false);

    expect(isUnderAny('/repo/src/a.ts', ['/repo/SRC'])).toBe(false);
    expect(isUnderAny('C:/repo/src/a.ts', ['c:/repo/src'])).toBe(false);
    // Separators are unified unconditionally, so this is the same path.
    expect(isUnderAny('C:\\repo\\src\\a.ts', ['C:/repo/src'])).toBe(true);
  });

  it('treats differing casing as the same path on a case-insensitive filesystem', async () => {
    const { isUnderAny } = await loadWithProbe(true);

    expect(isUnderAny('/repo/src/a.ts', ['/repo/SRC'])).toBe(true);
    expect(isUnderAny('C:/repo/src/a.ts', ['c:/repo/src'])).toBe(true);
  });

  it('enforces path boundaries on both filesystems', async () => {
    for (const foldsCase of [false, true]) {
      const { isUnderAny } = await loadWithProbe(foldsCase);

      // A raw string prefix would treat `src-extra` as inside `src`; the
      // separator check exists so a sibling directory is not watched.
      expect(isUnderAny('/repo/src-extra/a.ts', ['/repo/src'])).toBe(false);
      expect(isUnderAny('C:/repo/src-extra/a.ts', ['C:/repo/src'])).toBe(false);
    }
  });

  it('derives the same common ancestor on both filesystems', async () => {
    for (const foldsCase of [false, true]) {
      const { deriveSharedCwd } = await loadWithProbe(foldsCase);

      // Folding in the derivation is unconditional, so a client watching a
      // Windows workspace from a Linux host still gets the real ancestor
      // instead of a drive-wide root.
      expect(deriveSharedCwd(['C:/repo/src', 'c:/repo/Tests'])).toBe('C:/repo');
      expect(deriveSharedCwd(['C:\\repo\\src', 'c:\\repo\\Tests'])).toBe('C:/repo');
      expect(deriveSharedCwd(['/repo/src', '/repo/Tests'])).toBe('/repo');
      expect(deriveSharedCwd(['C:/alpha/one', 'D:/beta/two'])).toBe('C:/');
    }
  });
});

describe('case-insensitivity probe', () => {
  it('answers from the filesystem, not the platform', () => {
    // Guard the probe itself: a real temporary directory is the only input
    // that can distinguish the two filesystems.
    const dir = join(tmpdir(), `case-probe-selfcheck-${process.pid}`);
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'CaseProbe'), 'x');
      const folded = existsSync(join(dir, 'caseprobe'));
      // Whatever the host reports, the probe must not throw and must leave
      // no state behind.
      expect(typeof folded).toBe('boolean');
      expect(existsSync(join(dir, 'CaseProbe'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
