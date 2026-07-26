import { describe, expect, it } from 'vitest';

import type { Agent } from '../../../src/agent';
import type { ResponseLanguagePreference } from '../../../src/session/response-language';
import { ResponseLanguageInjector } from '../../../src/agent/injection/response-language';

function langAgent(): Agent {
  const history: unknown[] = [];
  return {
    getResponseLanguagePreference: (): ResponseLanguagePreference => ({
      code: 'ko',
      label: 'Korean',
      source: 'user',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }),
    context: {
      history,
      appendSystemReminder: (content: string) => {
        history.push({
          role: 'user',
          content: [{ type: 'text', text: content }],
          origin: { kind: 'injection', variant: 'response_language' },
        });
      },
    },
  } as unknown as Agent;
}

function history(agent: Agent): unknown[] {
  return agent.context.history as unknown[];
}

describe('ResponseLanguageInjector', () => {
  it('injects the directive when no prior injection exists', async () => {
    const agent = langAgent();
    const injector = new ResponseLanguageInjector(agent);
    await injector.inject();
    expect(history(agent).length).toBeGreaterThanOrEqual(1);
  });

  it('throttles repeated injections without a new user prompt', async () => {
    const agent = langAgent();
    const injector = new ResponseLanguageInjector(agent);
    await injector.inject();
    // No new user prompt, no assistant turns since the injection — well
    // under the 4-assistant-turn refresh cap. A second inject() must
    // not append a duplicate directive.
    await injector.inject();
    expect(history(agent).length).toBe(1);
  });

  it('shifts injectedAt by keptHeadCount so post-compaction throttling is correct', async () => {
    // Regression: without the keptHeadCount shift the response-language
    // injector would undercount the assistant turns since its prior
    // injection, letting the directive be re-emitted too early after a
    // compaction. Pin the math directly here: a prior injection at original
    // index 4, with compactedCount=2 and keptHeadCount=1, lands at
    // 1 + 1 + (4 - 2) = 4 — an unchanged-but-correct index.
    const agent = langAgent();
    const injector = new ResponseLanguageInjector(agent);
    await injector.inject();
    const internal = injector as unknown as { injectedAt: number | null };
    internal.injectedAt = 4;
    injector.onContextCompacted(2, 1);
    expect(internal.injectedAt).toBe(4);
    // A second compaction with a different head count shifts the index
    // by the new head count, not zero.
    internal.injectedAt = 7;
    injector.onContextCompacted(3, 2);
    expect(internal.injectedAt).toBe(2 + 1 + (7 - 3));
  });

  it('re-injects when a real user prompt arrives after the prior injection', async () => {
    const agent = langAgent();
    const injector = new ResponseLanguageInjector(agent);
    await injector.inject();
    history(agent).push({
      role: 'user',
      content: [{ type: 'text', text: '다음 작업 알려줘' }],
      origin: { kind: 'user' },
    });
    // A real user prompt is a hard refresh signal — the directive must
    // re-emit even though the assistant-turn cap is not hit. History
    // ends up with: 1 directive + 1 user prompt + 1 re-emitted directive.
    await injector.inject();
    expect(history(agent).length).toBe(3);
  });
});
