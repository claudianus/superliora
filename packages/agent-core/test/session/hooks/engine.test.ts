import { describe, expect, it } from 'vitest';

import { HookEngine } from '../../../src/session/hooks/engine';
import type { HookDef } from '../../../src/session/hooks/types';

function def(over: Partial<HookDef>): HookDef {
  return {
    name: 'h',
    command: 'echo hi',
    event: 'UserPromptSubmit',
    ...over,
  };
}

describe('hooks/engine.ts — HookEngine.summary', () => {
  it('returns an empty summary when no hooks are registered', () => {
    const engine = new HookEngine([]);
    expect(engine.summary).toEqual({});
  });

  it('reports the per-event hook counts', () => {
    const engine = new HookEngine([
      def({ name: 'a', event: 'UserPromptSubmit' }),
      def({ name: 'b', event: 'UserPromptSubmit' }),
      def({ name: 'c', event: 'SessionStart' }),
    ]);
    expect(engine.summary).toEqual({
      UserPromptSubmit: 2,
      SessionStart: 1,
    });
  });
});

describe('hooks/engine.ts — HookEngine.trigger (no matching hooks)', () => {
  it('resolves to an empty result list when no hook matches the event', async () => {
    const engine = new HookEngine([def({ name: 'a', event: 'SessionStart' })]);
    const out = await engine.trigger('UserPromptSubmit', { matcherValue: 'commit' });
    expect(out).toEqual([]);
  });

  it('returns the public trigger / fireAndForgetTrigger / triggerBlock / summary surface', () => {
    const engine = new HookEngine([]);
    expect(typeof engine.trigger).toBe('function');
    expect(typeof engine.fireAndForgetTrigger).toBe('function');
    expect(typeof engine.triggerBlock).toBe('function');
    // `summary` is a getter, not a method.
    expect(typeof engine.summary).toBe('object');
  });
});
