import { describe, expect, it, vi } from 'vitest';

import type { Agent } from '#/agent';
import type { ContextMessage } from '#/agent/context';
import { MemoryInjector } from '#/agent/injection/memory';

const makeUserMessage = (overrides: Partial<ContextMessage> = {}): ContextMessage =>
  ({
    role: 'user',
    origin: { kind: 'user', source: 'user' },
    content: [{ type: 'text', text: 'hi' }],
    ...overrides,
  }) as ContextMessage;

describe('agent/injection/memory — getInjection', () => {
  it('returns undefined when agent.type is not "main"', async () => {
    const injector = new MemoryInjector({
      type: 'sub',
      context: { history: [makeUserMessage()] },
      memory: { isEnabled: () => true, getInjection: vi.fn(async () => 'memo') },
    } as unknown as Agent);
    expect(await injector.getInjection()).toBeUndefined();
  });

  it('returns undefined when memory is undefined', async () => {
    const injector = new MemoryInjector({
      type: 'main',
      context: { history: [makeUserMessage()] },
      memory: undefined,
    } as unknown as Agent);
    expect(await injector.getInjection()).toBeUndefined();
  });

  it('returns undefined when memory is disabled', async () => {
    const injector = new MemoryInjector({
      type: 'main',
      context: { history: [makeUserMessage()] },
      memory: { isEnabled: () => false, getInjection: vi.fn() },
    } as unknown as Agent);
    expect(await injector.getInjection()).toBeUndefined();
  });

  it('returns undefined when there is no real user prompt in history', async () => {
    const injector = new MemoryInjector({
      type: 'main',
      context: { history: [] },
      memory: { isEnabled: () => true, getInjection: vi.fn() },
    } as unknown as Agent);
    expect(await injector.getInjection()).toBeUndefined();
  });

  it('invokes memory.getInjection with the latest user prompt text on first call', async () => {
    const getInjection = vi.fn(async (text: string) => `memo:${text}`);
    const injector = new MemoryInjector({
      type: 'main',
      context: { history: [makeUserMessage({ content: [{ type: 'text', text: 'hi there' }] })] },
      memory: { isEnabled: () => true, getInjection },
    } as unknown as Agent);
    const result = await injector.getInjection();
    expect(result).toBe('memo:hi there');
    expect(getInjection).toHaveBeenCalledOnce();
  });

  it('skips re-injection when the same user prompt is re-evaluated', async () => {
    const getInjection = vi.fn(async () => 'memo');
    const injector = new MemoryInjector({
      type: 'main',
      context: { history: [makeUserMessage()] },
      memory: { isEnabled: () => true, getInjection },
    } as unknown as Agent);
    expect(await injector.getInjection()).toBe('memo');
    expect(await injector.getInjection()).toBeUndefined();
  });
});

describe('agent/injection/memory — lifecycle', () => {
  it('onContextClear resets the attempted user-message index', async () => {
    const getInjection = vi.fn(async () => 'memo');
    const injector = new MemoryInjector({
      type: 'main',
      context: { history: [makeUserMessage()] },
      memory: { isEnabled: () => true, getInjection },
    } as unknown as Agent);
    expect(await injector.getInjection()).toBe('memo');
    injector.onContextClear();
    expect(await injector.getInjection()).toBe('memo');
  });

  it('onContextMessageRemoved clears when the indexed message is removed', async () => {
    const getInjection = vi.fn(async () => 'memo');
    const injector = new MemoryInjector({
      type: 'main',
      context: { history: [makeUserMessage()] },
      memory: { isEnabled: () => true, getInjection },
    } as unknown as Agent);
    expect(await injector.getInjection()).toBe('memo');
    injector.onContextMessageRemoved(0);
    // After clearing, empty history → no user prompt → undefined.
    (injector as unknown as { agent: Agent }).agent = {
      type: 'main',
      context: { history: [] },
      memory: { isEnabled: () => true, getInjection },
    } as unknown as Agent;
    expect(await injector.getInjection()).toBeUndefined();
  });

  it('onContextCompacted shifts the cached index by the compacted count', async () => {
    const getInjection = vi.fn(async () => 'memo');
    const injector = new MemoryInjector({
      type: 'main',
      context: { history: [makeUserMessage(), makeUserMessage()] },
      memory: { isEnabled: () => true, getInjection },
    } as unknown as Agent);
    expect(await injector.getInjection()).toBe('memo'); // latest = 1
    injector.onContextCompacted(1, 0); // lastAttemptedUserMessageAt 1 - 1 + 0 + 1 = 1
    // Same index still cached → re-eval on same message returns undefined.
    expect(await injector.getInjection()).toBeUndefined();
  });
});
