import { describe, expect, it, beforeEach } from 'vitest';

import {
  GIT_CHURN_BADGE_TTL_MS,
  formatGitChurnFooterBadge,
  formatGitChurnOpsLine,
  resetGitChurnSparkCache,
  tickGitChurnSpark,
} from '#/tui/utils/git/git-churn-spark';

describe('tickGitChurnSpark', () => {
  beforeEach(() => {
    resetGitChurnSparkCache();
  });

  it('seeds baseline on first dirty tick', () => {
    expect(tickGitChurnSpark('/tmp/repo', true, 2, 100)).toBeNull();
  });

  it('sparks when changed-file count increases on dirty tree', () => {
    tickGitChurnSpark('/tmp/repo', true, 2, 100);
    expect(tickGitChurnSpark('/tmp/repo', true, 5, 200)).toEqual({ atMs: 200, count: 3 });
  });

  it('skips clean tree and flat or decreasing counts', () => {
    tickGitChurnSpark('/tmp/repo', true, 2, 100);
    expect(tickGitChurnSpark('/tmp/repo', false, 5, 200)).toBeNull();
    expect(tickGitChurnSpark('/tmp/repo', true, 2, 300)).toBeNull();
    expect(tickGitChurnSpark('/tmp/repo', true, 1, 400)).toBeNull();
  });
});

describe('formatGitChurnOpsLine', () => {
  it('renders churn delta', () => {
    expect(formatGitChurnOpsLine({ atMs: 1, count: 2 })).toBe('churn +2');
    expect(formatGitChurnOpsLine(null)).toBeNull();
  });
});

describe('formatGitChurnFooterBadge', () => {
  const atMs = 1_000_000;

  it('shows diff↑ within TTL', () => {
    expect(formatGitChurnFooterBadge({ atMs, count: 1 }, atMs + GIT_CHURN_BADGE_TTL_MS - 1)).toEqual({
      text: 'diff↑',
      severity: 'info',
    });
  });

  it('hides at and after TTL', () => {
    expect(formatGitChurnFooterBadge({ atMs, count: 1 }, atMs + GIT_CHURN_BADGE_TTL_MS)).toBeNull();
  });
});
