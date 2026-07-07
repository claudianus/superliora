import { describe, expect, it } from 'vitest';

import type { Agent } from '../../../src/agent';
import type { ContextMessage } from '../../../src/agent/context';
import { USER_PROMPT_ORIGIN } from '../../../src/agent/context/types';
import { CurrentTimeInjector } from '../../../src/agent/injection/current-time';

interface CurrentTimeAgentStub {
  readonly history: ContextMessage[];
}

function currentTimeAgent(stub: CurrentTimeAgentStub): Agent {
  return {
    type: 'main',
    context: {
      get history() {
        return stub.history;
      },
      appendSystemReminder: (content: string, origin: ContextMessage['origin']) => {
        stub.history.push({
          role: 'user',
          content: [{ type: 'text', text: `<system-reminder>\n${content}\n</system-reminder>` }],
          toolCalls: [],
          origin,
        });
      },
    },
  } as unknown as Agent;
}

function userPrompt(text: string): ContextMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    toolCalls: [],
    origin: USER_PROMPT_ORIGIN,
  };
}

function assistantMessage(): ContextMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'working' }],
    toolCalls: [],
  };
}

function lastCurrentTimeReminder(history: readonly ContextMessage[]): string {
  const message = history.findLast(
    (entry) => entry.origin?.kind === 'injection' && entry.origin.variant === 'current_time',
  );
  return message?.content.map((part) => (part.type === 'text' ? part.text : '')).join('') ?? '';
}

describe('CurrentTimeInjector', () => {
  it('injects current time on a new user prompt', async () => {
    const history = [userPrompt('What happened in tech this year?')];
    const agent = currentTimeAgent({ history });
    const injector = new CurrentTimeInjector(agent);

    await injector.inject();

    const text = lastCurrentTimeReminder(history);
    expect(text).toContain('<current_time>');
    expect(text).toContain('Authoritative host clock');
    expect(text).toContain('GetCurrentTime');
    expect(text).toContain('WebSearch/FetchURL');
  });

  it('does not inject again on assistant-only continuation steps', async () => {
    const history = [userPrompt('Search for recent CVEs'), assistantMessage(), assistantMessage()];
    const agent = currentTimeAgent({ history });
    const injector = new CurrentTimeInjector(agent);

    await injector.inject();
    const afterFirst = history.length;
    await injector.inject();

    expect(history).toHaveLength(afterFirst);
  });

  it('injects again after compaction clears the dedup state', async () => {
    const history = [userPrompt('Continue the research')];
    const agent = currentTimeAgent({ history });
    const injector = new CurrentTimeInjector(agent);

    await injector.inject();
    const afterFirst = history.length;

    injector.onContextCompacted(0);
    await injector.inject();

    expect(history.length).toBeGreaterThan(afterFirst);
    expect(lastCurrentTimeReminder(history)).toContain('<current_time>');
  });

  it('injects again when a newer user prompt arrives', async () => {
    const history = [userPrompt('First question')];
    const agent = currentTimeAgent({ history });
    const injector = new CurrentTimeInjector(agent);

    await injector.inject();
    history.push(assistantMessage(), userPrompt('Follow-up question'));
    await injector.inject();

    const reminders = history.filter(
      (entry) =>
        entry.origin?.kind === 'injection' && entry.origin.variant === 'current_time',
    );
    expect(reminders).toHaveLength(2);
  });
});
