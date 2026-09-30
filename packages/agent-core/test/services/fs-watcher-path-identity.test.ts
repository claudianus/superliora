import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { deriveSharedCwd, isUnderAny } from '../../src/services/fs/fsWatcherService';

/**
 * Probe the filesystem rather than the platform. A Linux container on a
 * case-insensitive mount reports `linux` but folds case, which is how the
 * platform-based assumption passed locally and failed in CI on both sides:
 * Linux said "case-sensitive" and folded, Windows said "insensitive" and the
 * assertion was written for whichever host ran it.
 */
const CASE_INSENSITIVE = ((): boolean => {
  const dir = join(tmpdir(), `case-probe-${process.pid}`);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'CaseProbe'), 'x');
    return existsSync(join(dir, 'caseprobe'));
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();

describe('fsWatcher path identity', () => {
  it('treats a differently cased path as under its parent', () => {
    // `/repo/src/a.ts` under `/repo/SRC` — the same file, differently spelled.
    const inside = isUnderAny('/repo/src/a.ts', ['/repo/SRC']);
    const same = isUnderAny('/repo/Src', ['/repo/src']);
    if (CASE_INSENSITIVE) {
      expect(inside).toBe(true);
      expect(same).toBe(true);
    } else {
      // On a case-sensitive filesystem these really are different paths, and
      // folding would merge genuinely distinct files.
      expect(inside).toBe(false);
      expect(same).toBe(false);
    }
  });

  it('keeps a genuinely unrelated path outside every parent', () => {
    expect(isUnderAny('/repo/src/a.ts', ['/other/place'])).toBe(false);
    // Prefix must be a path boundary, not a raw string prefix.
    expect(isUnderAny('/repo/src-extra/a.ts', ['/repo/src'])).toBe(false);
  });

  it('still matches a path under its parent exactly', () => {
    expect(isUnderAny('/repo/src/a.ts', ['/repo/src'])).toBe(true);
    expect(isUnderAny('/repo/src', ['/repo/src'])).toBe(true);
  });

  it('derives a real common ancestor for mixed-casing inputs', () => {
    const root = deriveSharedCwd(['/repo/src', '/repo/Tests']);
    expect(root).toBe('/repo');
  });

  it('derives a real common ancestor from Windows-style paths', () => {
    // Runs identically on every platform. Folding in the derivation is
    // unconditional (unlike `isUnderAny`, which follows the host filesystem),
    // so a client watching a Windows workspace from a Linux host still gets
    // the real common ancestor instead of a drive-wide root.
    expect(deriveSharedCwd(['C:/repo/src', 'c:/repo/Tests'])).toBe('C:/repo');
    expect(deriveSharedCwd(['C:\\repo\\src', 'c:\\repo\\Tests'])).toBe('C:/repo');
  });

  it('falls back to the drive root, not a bare slash, for unrelated Windows paths', () => {
    const root = deriveSharedCwd(['C:/alpha/one', 'D:/beta/two']);
    expect(root).toBe('C:/');
    expect(root).not.toBe('/');
  });

  it('matches a path under its parent with either separator', () => {
    // Separator handling is unconditional; case folding follows the host
    // filesystem, because on a case-sensitive one `Src` and `src` really are
    // different directories and merging them would watch the wrong one.
    const caseFolded = process.platform === 'win32' || process.platform === 'darwin';
    expect(isUnderAny('C:/repo/src/a.ts', ['c:/repo/src'])).toBe(caseFolded);
    expect(isUnderAny('C:\\repo\\src\\a.ts', ['C:/repo/src'])).toBe(caseFolded);
    expect(isUnderAny('C:/repo/src/a.ts', ['C:/repo/src'])).toBe(true);
    expect(isUnderAny('C:\\repo\\src\\a.ts', ['C:\\repo\\src'])).toBe(true);
    expect(isUnderAny('C:/repo/src-extra/a.ts', ['C:/repo/src'])).toBe(false);
  });

  it('does not widen to the filesystem root for unrelated paths', () => {
    const root = deriveSharedCwd(['/alpha/one', '/beta/two']);
    expect(root).toBe('/');
  });
});
