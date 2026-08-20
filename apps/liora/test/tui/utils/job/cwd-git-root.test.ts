import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  detectCwdBelowGitRoot,
  formatCwdBelowGitRootNotice,
} from '#/tui/utils/job/cwd-git-root';

describe('cwd-git-root', () => {
  it('returns notice when cwd is nested under git toplevel', () => {
    const info = detectCwdBelowGitRoot('/repo/apps/liora', () => '/repo');
    expect(info).toEqual({ cwd: resolve('/repo/apps/liora'), gitRoot: resolve('/repo') });
    const notice = formatCwdBelowGitRootNotice(info!);
    expect(notice.title).toContain('Opened below git root');
    expect(notice.detail).toBe(resolve('/repo'));
  });

  it('returns undefined when cwd is the git root', () => {
    expect(detectCwdBelowGitRoot('/repo', () => '/repo')).toBeUndefined();
  });

  it('returns undefined when not a git repo', () => {
    expect(detectCwdBelowGitRoot('/tmp/x', () => undefined)).toBeUndefined();
  });
});
