import { sharedCredentialHealthStore } from '@superliora/oauth';
import { afterEach, describe, expect, it } from 'vitest';

import type { Agent } from '../../src/agent';
import {
  completionFlowApi,
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
