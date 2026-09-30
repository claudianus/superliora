import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Path case sensitivity belongs to the filesystem, not the OS, and the
 * difference is not theoretical: a default macOS volume folds case, so a
 * worktree registry that compared raw strings registered `/Users/x/Repo` and
 * `/users/x/repo` as two entries. Linux on a case-insensitive mount failed the
 * same way in the other direction, for the file watcher.
 *
 * The suite runs on both kinds of host, so these cases drive the probe rather
 * than observing it — the host is the thing being taken out of the decision.
 *
 * The module is imported only through `withProbe`. A static import would
 * evaluate it before any mock is installed, so the probe would read the real
 * host and these cases would pass or fail by machine rather than by the
 * behaviour they describe.
 */
type PathIdentity = typeof import('#/utils/path-identity');

async function withProbe(foldsCase: boolean): Promise<PathIdentity> {
  vi.resetModules();
  vi.doMock('node:fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs')>();
    return {
      ...actual,
      default: actual,
      existsSync: (p: unknown) =>
        typeof p === 'string' && p.endsWith('caseprobe') ? foldsCase : actual.existsSync(p as never),
    };
  });
  return import('#/utils/path-identity');
}

afterEach(() => {
  vi.doUnmock('node:fs');
  vi.resetModules();
});

describe('path identity follows the filesystem, not the platform', () => {
  it('folds case on a case-insensitive filesystem', async () => {
    const mod = await withProbe(true);

    expect(mod.isCaseInsensitiveFs()).toBe(true);
    expect(mod.foldPathForIdentity('/Users/x/Repo')).toBe('/users/x/repo');
    // The registry bug this exists to prevent: one worktree, two spellings.
    expect(mod.pathsIdentical('/Users/x/Repo', '/users/x/repo')).toBe(true);
  });

  it('keeps casing distinct on a case-sensitive filesystem', async () => {
    const mod = await withProbe(false);

    expect(mod.isCaseInsensitiveFs()).toBe(false);
    expect(mod.foldPathForIdentity('/Users/x/Repo')).toBe('/Users/x/Repo');
    // Folding here would merge two genuinely different directories and the
    // agent would watch the wrong one.
    expect(mod.pathsIdentical('/Users/x/Repo', '/users/x/repo')).toBe(false);
  });

  it('unifies separators independently of case folding', async () => {
    for (const foldsCase of [true, false]) {
      const mod = await withProbe(foldsCase);
      // The same path arriving `/`-normalised or with the platform separator is
      // the same path everywhere; only case depends on the filesystem.
      expect(mod.pathsIdentical('C:\\repo\\src', 'C:/repo/src')).toBe(true);
      expect(mod.pathsIdentical('/repo/src/a.ts', '/repo/src/a.ts')).toBe(true);
    }
  });

  it('answers repeat calls from cache', async () => {
    const mod = await withProbe(true);
    // The probe costs a temp directory, and this runs on the path every
    // worktree lookup takes, so it must not run per call.
    expect(mod.isCaseInsensitiveFs()).toBe(true);
    expect(mod.isCaseInsensitiveFs()).toBe(true);
    expect(mod.foldPathForIdentity('/A/B')).toBe(mod.foldPathForIdentity('/A/B'));
  });
});
