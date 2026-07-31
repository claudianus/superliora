import { describe, expect, it } from 'vitest';

import { HookEngine } from '#/session/hooks/engine';

/** Mirror Session.getHookRegistry — keep in sync with session/index.ts. */
function summarizeHookRegistry(engine: HookEngine): {
  readonly totalCount: number;
  readonly events: Readonly<Record<string, number>>;
} {
  const events = engine.summary;
  let totalCount = 0;
  for (const count of Object.values(events)) {
    totalCount += count;
  }
  return { totalCount, events };
}

describe('HookEngine registry summary', () => {
  it('aggregates event counts for Settings /ext hooks glance', () => {
    const engine = new HookEngine([
      { event: 'PreToolUse', command: 'exit 0', timeout: 5 },
      { event: 'PreToolUse', command: 'exit 0', timeout: 5 },
      { event: 'Stop', command: 'exit 0', timeout: 5 },
    ]);
    expect(summarizeHookRegistry(engine)).toEqual({
      totalCount: 3,
      events: { PreToolUse: 2, Stop: 1 },
    });
  });

  it('returns empty registry when no hooks are registered', () => {
    expect(summarizeHookRegistry(new HookEngine())).toEqual({
      totalCount: 0,
      events: {},
    });
  });
});
