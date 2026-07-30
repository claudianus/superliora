import { describe, expect, it } from 'vitest';

import { type Message, buildMessagesWithSystem, classifyProviderRouteFailure } from '#/agent/turn/kosong-llm';

describe('agent/turn/kosong-llm — buildMessagesWithSystem', () => {
  it('prepends the system message to the history', () => {
    const history: Message[] = [
      { role: 'user', content: 'hi' } as unknown as Message,
    ];
    const result = buildMessagesWithSystem('SYSTEM', history);
    expect(result).toHaveLength(2);
    const system = result[0]!;
    expect(system.role).toBe('system');
    expect((system as { content: unknown }).content).toEqual([
      { type: 'text', text: 'SYSTEM' },
    ]);
    expect(result[1]).toBe(history[0]);
  });

  it('returns the system message as the only entry when history is empty', () => {
    const result = buildMessagesWithSystem('ONLY', []);
    expect(result).toHaveLength(1);
    const system = result[0]!;
    expect(system.role).toBe('system');
    expect((system as { content: unknown }).content).toEqual([
      { type: 'text', text: 'ONLY' },
    ]);
  });

  it('does not mutate the input history', () => {
    const history: Message[] = [
      { role: 'user', content: 'hi' } as unknown as Message,
    ];
    buildMessagesWithSystem('SYSTEM', history);
    expect(history).toHaveLength(1);
  });
});

describe('agent/turn/kosong-llm — classifyProviderRouteFailure', () => {
  it('classifies a 429-ish error as rate_limit', () => {
    const err = new Error('rate_limited');
    (err as unknown as { code: string }).code = 'rate_limited';
    const result = classifyProviderRouteFailure(err, 1000);
    expect(result?.kind).toBe('rate_limit');
  });

  it('classifies a generic Error as undefined (no recognized status)', () => {
    expect(classifyProviderRouteFailure(new Error('boom'), 1000)).toBeUndefined();
  });

  it('returns undefined for an unrelated error', () => {
    const result = classifyProviderRouteFailure(new Error('boom'), 1000);
    expect(result).toBeUndefined();
  });

  it('returns undefined for a non-Error input', () => {
    expect(classifyProviderRouteFailure('plain string', 1000)).toBeUndefined();
    expect(classifyProviderRouteFailure(undefined, 1000)).toBeUndefined();
  });
});
