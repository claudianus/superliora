import { describe, expect, it } from 'vitest';

import {
  isUnderSessionWorktreesRoot,
  shouldCreateSessionWorktree,
} from '#/cli/resolve-worktree';
import { worktreesRoot } from '@superliora/sdk';
import { join } from 'node:path';

describe('shouldCreateSessionWorktree', () => {
  it('defaults to create for new sessions', () => {
    expect(shouldCreateSessionWorktree({})).toBe('create');
    expect(shouldCreateSessionWorktree({ worktree: undefined, autoIsolate: true })).toBe(
      'create',
    );
  });

  it('skips on --no-worktree / false', () => {
    expect(shouldCreateSessionWorktree({ worktree: false })).toBe('skip');
  });

  it('skips when autoIsolate is disabled (resume/continue)', () => {
    expect(shouldCreateSessionWorktree({ autoIsolate: false })).toBe('skip');
  });

  it('skips when env opt-out is set, unless named worktree', () => {
    expect(shouldCreateSessionWorktree({ envDisables: true })).toBe('skip');
    expect(shouldCreateSessionWorktree({ worktree: true, envDisables: true })).toBe('skip');
    expect(shouldCreateSessionWorktree({ worktree: 'feature-x', envDisables: true })).toBe(
      'create',
    );
  });

  it('skips when already inside a session worktree', () => {
    expect(
      shouldCreateSessionWorktree({
        alreadyInSessionWorktree: true,
        worktree: true,
      }),
    ).toBe('skip');
  });

  it('creates for explicit --worktree', () => {
    expect(shouldCreateSessionWorktree({ worktree: true })).toBe('create');
    expect(shouldCreateSessionWorktree({ worktree: 'my-branch' })).toBe('create');
  });
});

describe('isUnderSessionWorktreesRoot', () => {
  it('detects paths under ~/.superliora/worktrees', () => {
    const home = '/tmp/liora-home-test';
    const root = worktreesRoot(home);
    expect(isUnderSessionWorktreesRoot(root, home)).toBe(true);
    expect(isUnderSessionWorktreesRoot(join(root, 'repo', 'wt-1'), home)).toBe(true);
    expect(isUnderSessionWorktreesRoot('/tmp/other-project', home)).toBe(false);
  });
});
