import { describe, expect, it } from 'vitest';

import {
  isTeamTaskCompletionTransition,
  resolveTeamHookDecision,
} from '../../src/session/team-hooks';
import type { HookResult } from '../../src/session/hooks/types';

describe('resolveTeamHookDecision', () => {
  it('allows when no hooks fire', () => {
    expect(resolveTeamHookDecision([])).toEqual({ kind: 'allow' });
  });

  it('blocks with feedback on exit-2 style results', () => {
    const results: HookResult[] = [
      { action: 'allow' },
      { action: 'block', reason: 'lint failed', stderr: 'lint failed' },
    ];
    expect(resolveTeamHookDecision(results)).toEqual({
      kind: 'block',
      feedback: 'lint failed',
    });
  });

  it('prefers halt (continue:false) over block', () => {
    const results: HookResult[] = [
      { action: 'block', reason: 'keep working' },
      { action: 'allow', halt: true, stopReason: 'budget exhausted' },
    ];
    expect(resolveTeamHookDecision(results)).toEqual({
      kind: 'halt',
      reason: 'budget exhausted',
    });
  });

  it('forwards systemMessage on allow', () => {
    const results: HookResult[] = [
      { action: 'allow', systemMessage: 'heads up' },
    ];
    expect(resolveTeamHookDecision(results)).toEqual({
      kind: 'allow',
      systemMessage: 'heads up',
    });
  });
});

describe('isTeamTaskCompletionTransition', () => {
  it('fires for needs_integration and done transitions', () => {
    expect(isTeamTaskCompletionTransition('running', 'needs_integration')).toBe(true);
    expect(isTeamTaskCompletionTransition('needs_integration', 'done')).toBe(true);
    expect(isTeamTaskCompletionTransition('done', 'done')).toBe(false);
    expect(isTeamTaskCompletionTransition('queued', 'running')).toBe(false);
  });
});
