import { APIStatusError } from '@superliora/kosong';
import { describe, expect, it, vi } from 'vitest';

import { Agent } from '../../src/agent';
import {
  GOAL_PROVIDER_AUTO_RETRIES,
  GOAL_PROVIDER_RATE_LIMIT_AUTO_RETRIES,
  extractRetryAfterMs,
  isRateLimitOrQuotaFailure,
  isRetryableProviderFailure,
  listSwitchableFailoverModels,
  resolveProviderRecovery,
  resolveProviderRetryDelayMs,
} from '../../src/agent/provider-failover';
import { ErrorCodes, toKimiErrorPayload } from '../../src/errors';
import * as retry from '../../src/loop/retry';
import { testKaos } from '../fixtures/test-kaos';

describe('provider failover', () => {
  it('detects retryable provider failures', () => {
    const retryable = toKimiErrorPayload(new APIStatusError(500, 'server error', 'req-500'));
    expect(isRetryableProviderFailure(retryable)).toBe(true);

    const auth = toKimiErrorPayload(new APIStatusError(401, 'unauthorized', 'req-401'));
    expect(isRetryableProviderFailure(auth)).toBe(false);

    const quota = toKimiErrorPayload(
      new APIStatusError(429, 'You exceeded your current quota', 'req-429'),
    );
    expect(isRetryableProviderFailure(quota)).toBe(true);
    expect(isRateLimitOrQuotaFailure(quota)).toBe(true);
  });

  it('classifies insufficient_quota style API errors as rate-limit failures', () => {
    const quota = toKimiErrorPayload(
      new APIStatusError(400, 'insufficient_quota: billing hard limit reached', 'req-400'),
    );
    expect(quota.code).toBe(ErrorCodes.PROVIDER_RATE_LIMIT);
    expect(quota.retryable).toBe(true);
    expect(isRateLimitOrQuotaFailure(quota)).toBe(true);
  });

  it('honors retryAfterMs from error details', () => {
    const delay = resolveProviderRetryDelayMs(
      {
        code: ErrorCodes.PROVIDER_RATE_LIMIT,
        message: 'rate limited',
        retryable: true,
        details: { retryAfterMs: 12_500 },
      },
      0,
      true,
    );
    expect(delay).toBe(12_500);
    expect(
      extractRetryAfterMs({
        code: ErrorCodes.PROVIDER_RATE_LIMIT,
        message: 'rate limited',
        retryable: true,
        details: { retryAfterMs: 4_000 },
      }),
    ).toBe(4_000);
  });

  it('lists configured fallback model aliases', () => {
    const agent = new Agent({
      kaos: testKaos,
      config: {
        providers: {
          primary: { type: 'openai', apiKey: 'key', defaultModel: 'gpt-test' },
          backup: { type: 'openai', apiKey: 'key', defaultModel: 'gpt-backup' },
        },
        models: {
          primary: {
            provider: 'primary',
            model: 'gpt-test',
            maxContextSize: 128_000,
            fallbackModels: ['backup'],
          },
          backup: {
            provider: 'backup',
            model: 'gpt-backup',
            maxContextSize: 128_000,
            displayName: 'Backup GPT',
          },
        },
      },
    });
    agent.config.update({ modelAlias: 'primary' });

    expect(listSwitchableFailoverModels(agent)).toEqual([
      {
        alias: 'backup',
        providerName: 'backup',
        modelId: 'gpt-backup',
        displayName: 'Backup GPT',
      },
    ]);
  });

  it('auto-retries before silently switching to the configured fallback', async () => {
    const sleepSpy = vi.spyOn(retry, 'sleepForRetry').mockResolvedValue(undefined);
    const agent = new Agent({
      kaos: testKaos,
      config: {
        providers: {
          primary: { type: 'openai', apiKey: 'key', defaultModel: 'gpt-test' },
          backup: { type: 'openai', apiKey: 'key', defaultModel: 'gpt-backup' },
        },
        models: {
          primary: {
            provider: 'primary',
            model: 'gpt-test',
            maxContextSize: 128_000,
            fallbackModels: ['backup'],
          },
          backup: {
            provider: 'backup',
            model: 'gpt-backup',
            maxContextSize: 128_000,
          },
        },
      },
      rpc: {
        requestQuestion: vi.fn(),
      },
    });
    agent.config.update({ modelAlias: 'primary' });

    const error = toKimiErrorPayload(new APIStatusError(500, 'server error', 'req-500'));
    const signal = new AbortController().signal;

    const first = await resolveProviderRecovery(agent, {
      error,
      turnId: 1,
      signal,
      state: { autoRetryCount: 0, userPrompted: false },
    });
    expect(first).toEqual({ type: 'auto_retry' });
    expect(sleepSpy).toHaveBeenCalledTimes(1);

    const second = await resolveProviderRecovery(agent, {
      error,
      turnId: 1,
      signal,
      state: { autoRetryCount: 1, userPrompted: false },
    });
    expect(second).toEqual({ type: 'auto_retry' });

    const third = await resolveProviderRecovery(agent, {
      error,
      turnId: 1,
      signal,
      state: { autoRetryCount: 2, userPrompted: false },
    });
    expect(third).toEqual({ type: 'auto_retry' });
    expect(sleepSpy).toHaveBeenCalledTimes(3);

    // After the auto-retry budget, switch without prompting so Ultrawork can continue.
    const requestQuestion = vi.mocked(agent.rpc!.requestQuestion!);
    const switched = await resolveProviderRecovery(agent, {
      error,
      turnId: 1,
      signal,
      state: { autoRetryCount: GOAL_PROVIDER_AUTO_RETRIES, userPrompted: false },
    });
    expect(switched).toEqual({ type: 'switch', modelAlias: 'backup' });
    expect(requestQuestion).not.toHaveBeenCalled();

    sleepSpy.mockRestore();
  });

  it('auto-retries rate limits more times before switching', async () => {
    const sleepSpy = vi.spyOn(retry, 'sleepForRetry').mockResolvedValue(undefined);
    const agent = new Agent({
      kaos: testKaos,
      config: {
        providers: {
          primary: { type: 'openai', apiKey: 'key', defaultModel: 'gpt-test' },
          backup: { type: 'openai', apiKey: 'key', defaultModel: 'gpt-backup' },
        },
        models: {
          primary: {
            provider: 'primary',
            model: 'gpt-test',
            maxContextSize: 128_000,
            fallbackModels: ['backup'],
          },
          backup: {
            provider: 'backup',
            model: 'gpt-backup',
            maxContextSize: 128_000,
          },
        },
      },
    });
    agent.config.update({ modelAlias: 'primary' });

    const error = toKimiErrorPayload(new APIStatusError(429, 'rate limit exceeded', 'req-429'));

    for (let count = 0; count < GOAL_PROVIDER_RATE_LIMIT_AUTO_RETRIES; count += 1) {
      const outcome = await resolveProviderRecovery(agent, {
        error,
        turnId: 1,
        signal: new AbortController().signal,
        state: { autoRetryCount: count, userPrompted: false },
      });
      expect(outcome).toEqual({ type: 'auto_retry' });
    }

    const switched = await resolveProviderRecovery(agent, {
      error,
      turnId: 1,
      signal: new AbortController().signal,
      state: { autoRetryCount: GOAL_PROVIDER_RATE_LIMIT_AUTO_RETRIES, userPrompted: false },
    });
    expect(switched).toEqual({ type: 'switch', modelAlias: 'backup' });
    expect(sleepSpy).toHaveBeenCalledTimes(GOAL_PROVIDER_RATE_LIMIT_AUTO_RETRIES);

    sleepSpy.mockRestore();
  });

  it('pauses when no fallback exists and the user dismisses the failover question', async () => {
    const agent = new Agent({
      kaos: testKaos,
      config: {
        providers: {
          primary: { type: 'openai', apiKey: 'key', defaultModel: 'gpt-test' },
        },
        models: {
          primary: {
            provider: 'primary',
            model: 'gpt-test',
            maxContextSize: 128_000,
          },
        },
      },
      rpc: {
        requestQuestion: vi.fn(async () => null),
      },
    });
    agent.config.update({ modelAlias: 'primary' });

    const outcome = await resolveProviderRecovery(agent, {
      error: toKimiErrorPayload(new APIStatusError(500, 'server error', 'req-500')),
      turnId: 2,
      signal: new AbortController().signal,
      state: { autoRetryCount: GOAL_PROVIDER_AUTO_RETRIES, userPrompted: false },
    });

    expect(outcome).toEqual({ type: 'pause' });
  });
});
