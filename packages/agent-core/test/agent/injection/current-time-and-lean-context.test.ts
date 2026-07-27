import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CurrentTimeInjector } from '#/agent/injection/current-time';
import type { ContextMessage } from '#/agent/context';

class TestableCurrentTimeInjector extends CurrentTimeInjector {
  constructor(agent: Agent) {
    super();
    (this as unknown as { agent: Agent }).agent = agent;
  }
}

const makeMessage = (overrides: Partial<ContextMessage> = {}): ContextMessage =>
  ({
    role: 'user',
    origin: { kind: 'user', source: 'user' },
    content: [{ type: 'text', text: 'hi' }],
    ...overrides,
  }) as ContextMessage;

describe('agent/injection/current-time — getInjection', () => {
  const originalVitest = process.env['VITEST'];

  beforeEach(() => {
    process.env['VITEST'] = 'true';
  });

  afterEach(() => {
    if (originalVitest === undefined) {
      delete process.env['VITEST'];
    } else {
      process.env['VITEST'] = originalVitest;
    }
  });

  it('returns undefined when there is no user prompt in history', () => {
    const injector = new TestableCurrentTimeInjector({
      context: { history: [] },
    } as unknown as Agent);
    expect(injector.getInjection()).toBeUndefined();
  });

  it('returns the stable VITEST snapshot on first user prompt', () => {
    const injector = new TestableCurrentTimeInjector({
      context: { history: [makeMessage()] },
    } as unknown as Agent);
    const result = injector.getInjection();
    expect(result).toContain('2026-01-15');
  });

  it('returns undefined when the same user prompt is re-injected', () => {
    const injector = new TestableCurrentTimeInjector({
      context: { history: [makeMessage()] },
    } as unknown as Agent);
    expect(injector.getInjection()).toBeDefined();
    expect(injector.getInjection()).toBeUndefined();
  });

  it('returns undefined for a synthetic (non-user) origin', () => {
    const injector = new TestableCurrentTimeInjector({
      context: {
        history: [
          makeMessage({
            origin: { kind: 'system', source: 'bootstrap' } as never,
          }),
        ],
      },
    } as unknown as Agent);
    expect(injector.getInjection()).toBeUndefined();
  });

  it('skips a user message with empty trimmed text content', () => {
    const injector = new TestableCurrentTimeInjector({
      context: {
        history: [
          makeMessage({ content: [{ type: 'text', text: '   ' }] }),
        ],
      },
    } as unknown as Agent);
    expect(injector.getInjection()).toBeUndefined();
  });
});

describe('agent/injection/current-time — onContextMessageRemoved', () => {
  beforeEach(() => {
    process.env['VITEST'] = 'true';
  });

  it('resets lastInjectedUserMessageAt when an earlier message is removed', () => {
    const injector = new TestableCurrentTimeInjector({
      context: { history: [makeMessage(), makeMessage({ content: [{ type: 'text', text: 'again' }] })] },
    } as unknown as Agent);
    injector.getInjection(); // sets lastInjectedUserMessageAt
    injector.onContextMessageRemoved(0);
    // After removal of an earlier message, the next call should re-emit the
    // reminder (not return undefined).
    expect(injector.getInjection()).toBeDefined();
  });

  it('clears lastInjectedUserMessageAt when the injected message itself is removed', () => {
    const injector = new TestableCurrentTimeInjector({
      context: { history: [makeMessage()] },
    } as unknown as Agent);
    injector.getInjection();
    injector.onContextMessageRemoved(0);
    // After clearing, calling getInjection with an empty history → undefined.
    (injector as unknown as { agent: Agent }).agent = {
      context: { history: [] },
    } as unknown as Agent;
    expect(injector.getInjection()).toBeUndefined();
  });
});

describe('agent/injection/current-time — onContextCompacted', () => {
  it('resets the injected index when context is compacted', () => {
    process.env['VITEST'] = 'true';
    const injector = new TestableCurrentTimeInjector({
      context: { history: [makeMessage(), makeMessage({ content: [{ type: 'text', text: 'next' }] })] },
    } as unknown as Agent);
    injector.getInjection(); // set lastInjectedUserMessageAt
    injector.onContextCompacted(1, 0);
    // After compaction we drop the cached index, so the next call should re-emit.
    expect(injector.getInjection()).toBeDefined();
  });
});
