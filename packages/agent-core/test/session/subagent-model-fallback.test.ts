import { sharedCredentialHealthStore } from '@superliora/oauth';
import { afterEach, describe, expect, it } from 'vitest';

import type { Agent } from '../../src/agent';
import type { SmartRoute } from '../../src/agent/routing';
import {
  completionFlowApi,
  formatModelFailedNote,
  parseModelFailedNote,
  runPromptTurnWithModelFallback,
  subagentFallbackAliases,
} from '../../src/session/subagent/subagent-completion-flow';

interface FakeModelEntry {
  model: string;
  provider?: string;
  fallbackModels?: readonly string[];
}

function fakeChild(): { child: Agent; updates: string[] } {
  const models: Record<string, FakeModelEntry> = {
    primary: {
      model: 'm-primary',
      provider: 'kimi',
      fallbackModels: ['opencode/free', 'kimi/k2.5'],
    },
    'opencode/free': { model: 'deepseek-v4-flash-free', provider: 'opencode' },
    'kimi/k2.5': { model: 'kimi-k2.5', provider: 'kimi' },
  };
  const updates: string[] = [];
  const config = {
    modelAlias: 'primary',
    update(patch: { modelAlias?: string }) {
      if (patch.modelAlias !== undefined) {
        updates.push(patch.modelAlias);
        config.modelAlias = patch.modelAlias;
      }
    },
  };
  const child = { config, kimiConfig: { models } };
  return { child: child as unknown as Agent, updates };
}

const parent = { emitEvent: () => {} } as unknown as Agent;
const runOptions = {
  prompt: 'work',
  description: 'fallback test',
  parentToolCallId: 'call_fallback_test',
  signal: new AbortController().signal,
} as never;

function retryableTurnError(): Error {
  return Object.assign(new Error('rate limited'), { statusCode: 429 });
}

describe('subagentFallbackAliases', () => {
  afterEach(() => {
    sharedCredentialHealthStore.clear();
  });

  it('filters aliases rejected by the injected health check', () => {
    const { child } = fakeChild();
    expect(subagentFallbackAliases(child, (alias) => alias !== 'opencode/free')).toEqual([
      'kimi/k2.5',
    ]);
  });

  it('keeps configured fallback order when all providers are healthy', () => {
    const { child } = fakeChild();
    expect(subagentFallbackAliases(child)).toEqual(['opencode/free', 'kimi/k2.5']);
  });

  it('drops aliases whose provider credential is marked unhealthy', () => {
    sharedCredentialHealthStore.markRateLimited('opencode', { cooldownMs: 60_000 });
    const { child } = fakeChild();
    expect(subagentFallbackAliases(child)).toEqual(['kimi/k2.5']);
  });

  it('pinFallbacksFirst puts pin fallbackModels ahead of the role smart chain', () => {
    const { child } = fakeChild();
    const route: SmartRoute = {
      role: 'coding',
      intensity: 'balanced',
      alias: 'role-primary',
      chain: ['role-primary', 'role-secondary', 'opencode/free'],
      thinkingLevel: 'high',
      source: 'auto',
      reason: 'test',
    };
    // Default: role chain wins ordering (opencode appears via route before kimi).
    expect(subagentFallbackAliases(child, undefined, route)[0]).toBe('role-primary');
    // Conductor pin: configured fallbacks of `primary` first.
    expect(
      subagentFallbackAliases(child, undefined, route, { pinFallbacksFirst: true }),
    ).toEqual(['opencode/free', 'kimi/k2.5', 'role-primary', 'role-secondary']);
  });
});

describe('formatModelFailedNote', () => {
  it('round-trips alias / tried / next_hint for desk routing', () => {
    const note = formatModelFailedNote({
      alias: 'primary',
      kind: 'model_unavailable',
      tried: ['primary', 'opencode/free'],
      nextHint: 'kimi/k2.5',
    });
    expect(note).toBe(
      'model_failed: alias=primary kind=model_unavailable tried=[primary,opencode/free] next_hint=kimi/k2.5',
    );
    expect(parseModelFailedNote(`worker_failed: boom\n${note}`)).toEqual({
      alias: 'primary',
      kind: 'model_unavailable',
      tried: ['primary', 'opencode/free'],
      nextHint: 'kimi/k2.5',
    });
  });
});

describe('runPromptTurnWithModelFallback', () => {
  const originalRunPromptTurn = completionFlowApi.runPromptTurn;

  afterEach(() => {
    completionFlowApi.runPromptTurn = originalRunPromptTurn;
    sharedCredentialHealthStore.clear();
  });

  it('hops through configured fallback_models on retryable failure', async () => {
    const { child, updates } = fakeChild();
    const seenAliases: string[] = [];
    completionFlowApi.runPromptTurn = (async (
      _parent: Agent,
      _childId: string,
      turnChild: Agent,
    ) => {
      seenAliases.push(turnChild.config.modelAlias ?? '');
      if (seenAliases.length === 1) throw retryableTurnError();
      return { result: 'ok' } as never;
    }) as typeof originalRunPromptTurn;

    const completion = await runPromptTurnWithModelFallback(
      parent,
      'child_1',
      child,
      'coder',
      runOptions,
    );
    expect(completion.result).toBe('ok');
    expect(seenAliases).toEqual(['primary', 'opencode/free']);
    expect(updates).toEqual(['opencode/free']);
  });

  it('Conductor model_alias pin hops pin fallbackModels before role chain', async () => {
    const { child, updates } = fakeChild();
    const seenAliases: string[] = [];
    completionFlowApi.runPromptTurn = (async (
      _parent: Agent,
      _childId: string,
      turnChild: Agent,
    ) => {
      seenAliases.push(turnChild.config.modelAlias ?? '');
      if (seenAliases.length === 1) throw retryableTurnError();
      return { result: 'ok' } as never;
    }) as typeof originalRunPromptTurn;

    const completion = await runPromptTurnWithModelFallback(
      parent,
      'child_pin',
      child,
      'coder',
      { ...runOptions, modelAlias: 'primary' },
    );
    expect(completion.result).toBe('ok');
    // Pin-first: primary's fallbackModels[0] = opencode/free
    expect(seenAliases).toEqual(['primary', 'opencode/free']);
    expect(updates).toEqual(['opencode/free']);
  });

  it('appends model_failed note when every hop is exhausted', async () => {
    const { child } = fakeChild();
    completionFlowApi.runPromptTurn = (async () => {
      throw retryableTurnError();
    }) as typeof originalRunPromptTurn;

    await expect(
      runPromptTurnWithModelFallback(parent, 'child_exhausted', child, 'coder', {
        ...runOptions,
        modelAlias: 'primary',
      }),
    ).rejects.toThrow(/model_failed: alias=/);
  });

  it('never hops into a provider already marked dead (regression: explore model 403)', async () => {
    // The primary provider flaps retryably; the first configured fallback
    // points at a provider whose credentials are exhausted. The hop must skip
    // it instead of burning one request on a guaranteed 403.
    sharedCredentialHealthStore.markRateLimited('opencode', {
      cooldownMs: 60_000,
      failureReason: 'credits exhausted',
    });
    const { child, updates } = fakeChild();
    const seenAliases: string[] = [];
    completionFlowApi.runPromptTurn = (async (
      _parent: Agent,
      _childId: string,
      turnChild: Agent,
    ) => {
      seenAliases.push(turnChild.config.modelAlias ?? '');
      if (seenAliases.length === 1) throw retryableTurnError();
      return { result: 'ok' } as never;
    }) as typeof originalRunPromptTurn;

    const completion = await runPromptTurnWithModelFallback(
      parent,
      'child_2',
      child,
      'coder',
      runOptions,
    );
    expect(completion.result).toBe('ok');
    expect(seenAliases).toEqual(['primary', 'kimi/k2.5']);
    expect(updates).toEqual(['kimi/k2.5']);
  });
});
