import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  destIsUserDesktopDocument,
  inferPlayableFromChangeSet,
  isForbiddenDestRelPath,
  syncPlayableFilesToDest,
} from '../../src/tools/builtin/job/job-playable';

describe('job-playable dest guards', () => {
  it('treats Desktop markdown as a general-track dest', () => {
    expect(
      destIsUserDesktopDocument(
        'C:/Users/Administrator/Desktop/SuperLiora-하네스-개선점-2026-08-23.md',
      ),
    ).toBe(true);
    expect(destIsUserDesktopDocument('C:/Users/Administrator/Desktop/test')).toBe(false);
    expect(destIsUserDesktopDocument('D:/superliora/README.md')).toBe(false);
  });

  it('forbids dest .git, node_modules, and NVIDIA Corporation', () => {
    expect(isForbiddenDestRelPath('.git/config')).toBe(true);
    expect(isForbiddenDestRelPath('node_modules/foo/index.js')).toBe(true);
    expect(isForbiddenDestRelPath('NVIDIA Corporation/foo')).toBe(true);
    expect(isForbiddenDestRelPath('index.html')).toBe(false);
    expect(isForbiddenDestRelPath('js/game.js')).toBe(false);
  });

  it('infers playable from index.html or a localhost serve path', () => {
    expect(inferPlayableFromChangeSet(['index.html', 'js/game.js'])).toBe('yes');
    expect(
      inferPlayableFromChangeSet([], 'serve=python -m http.server 8765 → http://localhost:8765'),
    ).toBe('yes');
  });

  it('copies product files and skips .git', () => {
    const root = mkdtempSync(join(tmpdir(), 'playable-'));
    const src = join(root, 'wt');
    const dest = join(root, 'dest');
    mkdirSync(join(src, 'js'), { recursive: true });
    mkdirSync(join(src, '.git'), { recursive: true });
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(src, 'index.html'), '<html></html>');
    writeFileSync(join(src, 'js', 'game.js'), 'export {}');
    writeFileSync(join(src, '.git', 'config'), 'do-not-copy');

    const result = syncPlayableFilesToDest({
      worktreePath: src,
      destPath: dest,
      filesChanged: ['index.html', 'js/game.js', '.git/config'],
    });
    expect(result.ok).toBe(true);
    expect(result.copied).toBe(2);
    expect(readFileSync(join(dest, 'index.html'), 'utf8')).toContain('<html>');
    expect(() => readFileSync(join(dest, '.git', 'config'), 'utf8')).toThrow();
  });
});
