import { describe, expect, it } from 'vitest';

import {
  SUPERLIORA_BOT_AUTHOR,
  autoFixCommitMessage,
  buildJobSnapshotCommitMessage,
  commitIdentityArgs,
  resolveCommitAuthor,
  validateCommitMessage,
} from '../../src/tools/support/git-commit-policy';

describe('git-commit-policy', () => {
  it('prefers configured git identity over the bot fallback', () => {
    const author = resolveCommitAuthor({ name: 'Jane Doe', email: 'jane@example.com' });
    expect(author).toEqual({
      name: 'Jane Doe',
      email: 'jane@example.com',
      isBotFallback: false,
    });
    expect(commitIdentityArgs(author)).toEqual([
      '-c',
      'user.name=Jane Doe',
      '-c',
      'user.email=jane@example.com',
    ]);
  });

  it('falls back to the documented SuperLiora bot identity', () => {
    const author = resolveCommitAuthor({});
    expect(author.name).toBe(SUPERLIORA_BOT_AUTHOR.name);
    expect(author.email).toBe(SUPERLIORA_BOT_AUTHOR.email);
    expect(author.isBotFallback).toBe(true);
  });

  it('accepts conventional commits and rejects vague subjects', () => {
    expect(validateCommitMessage('feat(tui): show session outcome board').ok).toBe(true);
    expect(validateCommitMessage('fix:').ok).toBe(false);
    expect(validateCommitMessage('update').ok).toBe(false);
    expect(validateCommitMessage('chore: wip').ok).toBe(false);
    expect(validateCommitMessage('chore: job_abc123').ok).toBe(false);
    expect(validateCommitMessage('feat(tui): add board.').ok).toBe(false);
  });

  it('auto-fixes free text into conventional form', () => {
    const fixed = autoFixCommitMessage('Snap dirty worktree for land');
    expect(fixed.startsWith('chore: ')).toBe(true);
    expect(validateCommitMessage(fixed).ok).toBe(true);
  });

  it('builds job snapshot messages with Job-Id in the body', () => {
    const message = buildJobSnapshotCommitMessage({
      jobId: 'job_deadbeef',
      jobTitle: 'TUI 세션 결과 현황판',
    });
    expect(message).toContain('chore(job):');
    expect(message).toContain('TUI 세션 결과 현황판');
    expect(message).toContain('Job-Id: job_deadbeef');
    expect(validateCommitMessage(message).ok).toBe(true);
  });
});
