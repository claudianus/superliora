import { describe, expect, it, vi } from 'vitest';

import type { Agent } from '#/agent';
import type { ContextMessage } from '#/agent/context';
import { ContextOSInjector } from '#/agent/injection/context-os';

const userMessage = (overrides: Partial<ContextMessage> = {}): ContextMessage =>
  ({
    role: 'user',
    origin: { kind: 'user', source: 'user' },
    content: [{ type: 'text', text: 'hi' }],
    ...overrides,
  }) as ContextMessage;

const injectionMessage = (variant: string): ContextMessage =>
  ({
    role: 'user',
    origin: { kind: 'injection', variant },
    content: [{ type: 'text', text: '' }],
  }) as ContextMessage;

const buildAgent = (
  history: ContextMessage[],
  options: { type?: string; revision?: number; injection?: string } = {},
): Agent => {
  const buildInjection = vi.fn((_text: string) => options.injection ?? 'CTXOS_INJECTION');
  return {
    type: options.type ?? 'main',
    context: { history },
    contextOS: { revision: options.revision ?? 1, buildInjection },
  } as unknown as Agent;
};

class TestableContextOSInjector extends ContextOSInjector {
  // base class wires `agent` from constructor.
}

describe('agent/injection/context-os — getInjection', () => {
  it('returns undefined when agent.type is not main', () => {
    const injector = new TestableContextOSInjector();
    (injector as unknown as { agent: Agent }).agent = buildAgent([userMessage()], { type: 'sub' });
    expect(injector.getInjection()).toBeUndefined();
  });

  it('returns undefined when there is no real user prompt', () => {
    const injector = new TestableContextOSInjector();
    (injector as unknown as { agent: Agent }).agent = buildAgent([]);
    expect(injector.getInjection()).toBeUndefined();
  });

  it('returns the context-OS injection when the trailing block is all injection messages', () => {
    const injector = new TestableContextOSInjector();
    (injector as unknown as { agent: Agent }).agent = buildAgent(
      [
        userMessage({ content: [{ type: 'text', text: 'real' }] }),
        injectionMessage('context_os'),
        injectionMessage('context_os'),
      ],
      { injection: 'CTXOS_OK', revision: 1 },
    );
    const result = injector.getInjection();
    expect(result).toBe('CTXOS_OK');
  });

  it('skips re-injection when the signature has not advanced', () => {
    const injector = new TestableContextOSInjector();
    (injector as unknown as { agent: Agent }).agent = buildAgent(
      [
        userMessage({ content: [{ type: 'text', text: 'real' }] }),
        injectionMessage('context_os'),
      ],
      { revision: 1 },
    );
    expect(injector.getInjection()).toBeDefined();
    expect(injector.getInjection()).toBeUndefined();
  });

  it('onContextClear resets the cached signature so the next call re-emits', () => {
    const injector = new TestableContextOSInjector();
    (injector as unknown as { agent: Agent }).agent = buildAgent(
      [
        userMessage({ content: [{ type: 'text', text: 'real' }] }),
        injectionMessage('context_os'),
      ],
      { revision: 1 },
    );
    expect(injector.getInjection()).toBeDefined();
    injector.onContextClear();
    expect(injector.getInjection()).toBeDefined();
  });
});
