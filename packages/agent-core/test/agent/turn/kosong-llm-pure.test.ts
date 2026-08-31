import { APIStatusError, APITimeoutError } from '@superliora/kosong';
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

  it('fails over a provider-declared temporary 400 like a server blip', () => {
    const err = new APIStatusError(
      400,
      'resource_exhausted: ERROR_PROVIDER_ERROR — temporary - try again in a moment',
    );
    expect(classifyProviderRouteFailure(err, 1000)?.kind).toBe('server');
    expect(
      classifyProviderRouteFailure(new APIStatusError(400, 'Invalid request body'), 1000),
    ).toBeUndefined();
  });

  it('fails over Cloudflare 52x and Anthropic 529 without try-again copy', () => {
    expect(classifyProviderRouteFailure(new APIStatusError(524, 'error code: 524'), 1000)?.kind).toBe(
      'server',
    );
    expect(classifyProviderRouteFailure(new APIStatusError(529, 'error'), 1000)?.kind).toBe('server');
  });

  it('returns undefined for an unrelated error', () => {
    const result = classifyProviderRouteFailure(new Error('boom'), 1000);
    expect(result).toBeUndefined();
  });

  it('returns undefined for a non-Error input', () => {
    expect(classifyProviderRouteFailure('plain string', 1000)).toBeUndefined();
    expect(classifyProviderRouteFailure(undefined, 1000)).toBeUndefined();
  });

  it('classifies 404 as model_unavailable', () => {
    const result = classifyProviderRouteFailure(new APIStatusError(404, 'Not Found'), 1000);
    expect(result?.kind).toBe('model_unavailable');
    expect(result?.cooldownMs).toBeGreaterThan(0);
  });

  it('classifies model_not_found 400 as model_unavailable', () => {
    const result = classifyProviderRouteFailure(
      new APIStatusError(400, 'model_not_found: The model does not exist'),
      1000,
    );
    expect(result?.kind).toBe('model_unavailable');
  });

  it('classifies a per-model 403 region opt-in as model_unavailable (alias-scoped)', () => {
    // Observed in the wild: one region-locked SKU on an OpenAI-compatible
    // gateway returned 403 RegionError while every sibling on the same key
    // stayed healthy. Reclassifying as auth poisoned the whole provider.
    const result = classifyProviderRouteFailure(
      new APIStatusError(
        403,
        'RegionError: The latest version of this model is only available hosted in China and requires explicit opt in',
      ),
      1000,
    );
    expect(result?.kind).toBe('model_unavailable');
  });

  it('still classifies a plain 403/401 as auth (credential-scoped)', () => {
    expect(classifyProviderRouteFailure(new APIStatusError(403, 'Forbidden'), 1000)?.kind).toBe(
      'auth',
    );
    expect(classifyProviderRouteFailure(new APIStatusError(401, 'Unauthorized'), 1000)?.kind).toBe(
      'auth',
    );
  });

  it('does not treat invalid request body 400 as model_unavailable', () => {
    expect(
      classifyProviderRouteFailure(new APIStatusError(400, 'Invalid request body'), 1000),
    ).toBeUndefined();
  });

  it('classifies AbortSignal timeout / "The operation was aborted" as timeout', () => {
    const aborted = new DOMException('The operation was aborted.', 'AbortError');
    const timeoutNamed = Object.assign(new Error('This operation was aborted'), {
      name: 'TimeoutError',
    });
    const abortNamed = Object.assign(new Error('The operation was aborted.'), {
      name: 'AbortError',
    });

    expect(classifyProviderRouteFailure(aborted, 1000)?.kind).toBe('timeout');
    expect(classifyProviderRouteFailure(timeoutNamed, 1000)?.kind).toBe('timeout');
    expect(classifyProviderRouteFailure(abortNamed, 1000)?.kind).toBe('timeout');
    expect(classifyProviderRouteFailure(aborted, undefined)?.cooldownMs).toBe(30_000);
  });

  it('does not treat a user cancellation abort as a route timeout', () => {
    const cancelled = Object.assign(new Error('Aborted by the user'), {
      name: 'AbortError',
      userCancelled: true,
    });
    expect(classifyProviderRouteFailure(cancelled, 1000)).toBeUndefined();
  });

  it('fails over a custom OpenAI-compatible Request-was-aborted timeout', () => {
    const converted = new APITimeoutError('Request was aborted.');
    const raw = Object.assign(new Error('Request was aborted.'), { name: 'APIUserAbortError' });
    expect(classifyProviderRouteFailure(converted, 1000)?.kind).toBe('timeout');
    expect(classifyProviderRouteFailure(raw, 1000)?.kind).toBe('timeout');
    expect(
      classifyProviderRouteFailure(new APIStatusError(400, 'Invalid request body'), 1000),
    ).toBeUndefined();
  });

  it('keeps unsupported-parameter 400 unclassified (not quota/auth/model_unavailable)', () => {
    expect(
      classifyProviderRouteFailure(
        new APIStatusError(400, 'does not support parameter reasoningEffort'),
        1000,
      ),
    ).toBeUndefined();
  });
});
