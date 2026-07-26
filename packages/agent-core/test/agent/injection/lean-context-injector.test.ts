import { describe, expect, it } from 'vitest';

import type { Agent } from '../../../src/agent';
import { LeanContextInjector } from '../../../src/agent/injection/lean-context-injector';
import { buildLeanContextGuidance } from '../../../src/agent/injection/lean-context';

function leanAgent(toolNames: readonly string[] = ['LioraRead', 'Grep']): Agent {
  const history: unknown[] = [];
  return {
    tools: {
      loopTools: toolNames.map((name) => ({ name })),
    },
    context: {
      history,
      appendSystemReminder: (content: string) => {
        history.push({
          role: 'user',
          content: [{ type: 'text', text: content }],
          origin: { kind: 'injection', variant: 'lean_context' },
        });
      },
    },
  } as unknown as Agent;
}

function history(agent: Agent): unknown[] {
  return agent.context.history as unknown[];
}

describe('LeanContextInjector', () => {
  it('injects lean-context guidance when lean tools are enabled', async () => {
    const agent = leanAgent();
    const injector = new LeanContextInjector(agent);
    await injector.inject();
    expect(history(agent)).toHaveLength(1);
    const first = history(agent)[0] as { content: Array<{ text: string }> };
    expect(first.content[0]?.text).toContain(buildLeanContextGuidance().slice(0, 40));
  });

  it('does not re-inject every step without a real user prompt', async () => {
    const agent = leanAgent();
    const injector = new LeanContextInjector(agent);
    await injector.inject();
    history(agent).push({ role: 'assistant' });
    await injector.inject();
    expect(history(agent)).toHaveLength(2);
  });

  it('re-injects after a real user prompt', async () => {
    const agent = leanAgent();
    const injector = new LeanContextInjector(agent);
    await injector.inject();
    history(agent).push({
      role: 'user',
      content: [{ type: 'text', text: 'find the auth middleware' }],
      origin: { kind: 'user' },
    });
    await injector.inject();
    expect(history(agent)).toHaveLength(3);
  });

  it('skips when no lean tools are active', async () => {
    const agent = leanAgent(['Read', 'Grep']);
    const injector = new LeanContextInjector(agent);
    await injector.inject();
    expect(history(agent)).toHaveLength(0);
  });

  it('shifts injectedAt by keptHeadCount so post-compaction shouldRefresh is accurate', () => {
    // Regression for the onContextCompacted off-by-one: without the head
    // shift, the post-compaction shouldRefresh scan walks the WRONG slice of
    // history and either re-injects prematurely or skips a turn it should
    // emit. We pin the math directly here: a prior injection at original
    // index 5, with compactedCount=3 and keptHeadCount=2, lands at
    // 2 + 1 + (5 - 3) = 5 — i.e. unchanged but for the right reason.
    const agent = leanAgent();
    const injector = new LeanContextInjector(agent);
    const internal = injector as unknown as { injectedAt: number | null };
    internal.injectedAt = 5;
    injector.onContextCompacted(3, 2);
    expect(internal.injectedAt).toBe(5);
    // A second compaction with a different head count shifts the index
    // by the new head count, not zero.
    internal.injectedAt = 6;
    injector.onContextCompacted(2, 4);
    expect(internal.injectedAt).toBe(4 + 1 + (6 - 2));
    // Compaction that drops the injection entirely clears the marker.
    internal.injectedAt = 1;
    injector.onContextCompacted(4, 0);
    expect(internal.injectedAt).toBeNull();
  });
});
