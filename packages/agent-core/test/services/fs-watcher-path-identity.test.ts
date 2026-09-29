import { describe, expect, it } from 'vitest';

import { deriveSharedCwd, isUnderAny } from '../../src/services/fs/fsWatcherService';

/**
 * Windows and macOS compare paths case-insensitively, and chokidar reports the
 * on-disk casing rather than the casing a client registered. Raw string
 * comparison therefore dropped change events, and the shared-root derivation
 * collapsed to `/`, rooting the watcher at an entire drive.
 */
const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin';

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

  it('does not widen to the filesystem root for unrelated paths', () => {
    const root = deriveSharedCwd(['/alpha/one', '/beta/two']);
    expect(root).toBe('/');
  });
});
