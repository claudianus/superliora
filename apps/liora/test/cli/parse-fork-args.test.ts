import { describe, expect, it } from 'vitest';

import { parseForkArgs } from '#/tui/commands/session/session';

describe('parseForkArgs', () => {
  it('returns empty for plain fork', () => {
    expect(parseForkArgs('')).toEqual({});
    expect(parseForkArgs('   ')).toEqual({});
  });

  it('parses --worktree flag without name', () => {
    expect(parseForkArgs('--worktree')).toEqual({ worktree: true });
    expect(parseForkArgs('-w')).toEqual({ worktree: true });
  });

  it('parses --worktree with name', () => {
    expect(parseForkArgs('--worktree fix-auth')).toEqual({
      worktree: { name: 'fix-auth' },
    });
    expect(parseForkArgs('--worktree=feature-x')).toEqual({
      worktree: { name: 'feature-x' },
    });
  });
});
