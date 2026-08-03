/**
 * V7-2 (incident 2): exploration_model 403 routing reproduction.
 *
 * An explore subagent routed to an exploration model whose provider
 * credentials are not entitled (HTTP 403) must not be routed back into the
 * same alias on the next spawn/resume/retry. The 403 turn failure has to
 * poison the alias's provider credential in the shared health store that
 * `isModelAliasHealthy` (and therefore every `resolveSubagentModelAlias`
 * call site) reads.
 */

import { sharedCredentialHealthStore } from '@superliora/oauth';
import { afterEach, describe, expect, it } from 'vitest';

import type { Agent } from '../../src/agent';
import {
  completionFlowApi,
  runPromptTurnWithModelFallback,
} from '../../src/session/subagent/subagent-completion-flow';
import {
  isModelAliasHealthy,
  markModelAliasAuthRejected,
} from '../../src/session/subagent/subagent-run-lifecycle';
import { resolveSubagentModelAlias } from '../../src/utils/cheap-model';

interface FakeModelEntry {
  model: string;
  provider?: string;
}

const models: Record<string, FakeModelEntry> = {
  primary: { model: 'm-primary', provider: 'kimi' },
  fast: { model: 'gemini-2.5-flash-lite', provider: 'google' },
  'opencode/explore': { model: 'explore-cheap', provider: 'opencode' },
};

function exploreChild(): { child: Agent } {
  const config = {
    // The child was already routed onto the exploration alias by
    // configureSubagentChild/spawnModelAlias before the turn starts.
    modelAlias: 'opencode/explore',
    update(patch: { modelAlias?: string }) {
      if (patch.modelAlias !== undefined) config.modelAlias = patch.modelAlias;
    },
  };
  const child = { config, kimiConfig: { models } };
  return { child: child as unknown as Agent };
}

const parent = { emitEvent: () => {} } as unknown as Agent;
const runOptions = {
  prompt: 'explore the codebase',
  description: '403 marking test',
  parentToolCallId: 'call_403_marking',
  signal: new AbortController().signal,
} as never;

/** Mirrors runChildTurnToCompletion: flattened turn error with statusCode copied on. */
function forbiddenTurnError(): Error {
  return Object.assign(new Error('403 {"error":"model not permitted for this subscription"}'), {
    statusCode: 403,
  });
}

describe('V7-2 (b): exploration model 403 marks the alias unhealthy', () => {
  const originalRunPromptTurn = completionFlowApi.runPromptTurn;

  afterEach(() => {
    completionFlowApi.runPromptTurn = originalRunPromptTurn;
    sharedCredentialHealthStore.clear();
  });

  it('marks the failed alias provider auth_rejected when the turn receives 403', async () => {
    const { child } = exploreChild();
    completionFlowApi.runPromptTurn = (async () => {
      throw forbiddenTurnError();
    }) as typeof originalRunPromptTurn;

    await expect(
      runPromptTurnWithModelFallback(parent, 'child_403', child, 'explore', runOptions),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(sharedCredentialHealthStore.isAvailable('opencode')).toBe(false);
    expect(sharedCredentialHealthStore.get('opencode')?.status).toBe('auth_rejected');
    // The parent's own provider must not be poisoned by the child's 403.
    expect(sharedCredentialHealthStore.isAvailable('kimi')).toBe(true);
  });

  it('blocks re-routing into the 403-marked exploration alias (incident reproduction)', async () => {
    const { child } = exploreChild();
    completionFlowApi.runPromptTurn = (async () => {
      throw forbiddenTurnError();
    }) as typeof originalRunPromptTurn;
    await expect(
      runPromptTurnWithModelFallback(parent, 'child_403_b', child, 'explore', runOptions),
    ).rejects.toThrow();

    // The next spawn/resume/retry resolves through the same health check the
    // production call sites (configureSubagentChild, retrySubagentTurn,
    // resolveResumeModelAlias, spawnModelAlias) use. The rejected alias must
    // lose to the healthy cheap alias instead of earning another 403.
    const rerouted = resolveSubagentModelAlias(
      'explore',
      undefined,
      'primary',
      models,
      'opencode/explore',
      { isAliasHealthy: (alias) => isModelAliasHealthy(alias, models) },
    );
    expect(rerouted).not.toBe('opencode/explore');
    expect(rerouted).toBe('fast');
  });

  it('does not poison the alias on retryable (non-auth) failures', async () => {
    const { child } = exploreChild();
    completionFlowApi.runPromptTurn = (async () => {
      throw Object.assign(new Error('rate limited'), { statusCode: 429 });
    }) as typeof originalRunPromptTurn;

    await expect(
      runPromptTurnWithModelFallback(parent, 'child_429', child, 'explore', runOptions),
    ).rejects.toThrow();

    expect(sharedCredentialHealthStore.isAvailable('opencode')).toBe(true);
  });
});

describe('markModelAliasAuthRejected', () => {
  afterEach(() => {
    sharedCredentialHealthStore.clear();
  });

  it('marks the alias provider auth_rejected and reports true', () => {
    expect(
      markModelAliasAuthRejected('opencode/explore', models, new Error('403 forbidden')),
    ).toBe(true);
    const record = sharedCredentialHealthStore.get('opencode');
    expect(record?.status).toBe('auth_rejected');
    expect(record?.failureReason).toBe('403 forbidden');
    expect(sharedCredentialHealthStore.isAvailable('opencode')).toBe(false);
  });

  it('is a no-op for unknown aliases, missing models, or provider-less entries', () => {
    expect(markModelAliasAuthRejected('ghost', models)).toBe(false);
    expect(markModelAliasAuthRejected(undefined, models)).toBe(false);
    expect(markModelAliasAuthRejected('opencode/explore', undefined)).toBe(false);
    expect(markModelAliasAuthRejected('no-provider', { 'no-provider': { model: 'm' } })).toBe(
      false,
    );
    expect(sharedCredentialHealthStore.snapshot()).toHaveLength(0);
  });
});
