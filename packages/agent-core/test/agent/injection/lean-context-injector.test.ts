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
});
