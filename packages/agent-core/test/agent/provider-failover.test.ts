import { APIStatusError } from '@superliora/kosong';
import { describe, expect, it, vi } from 'vitest';

import { Agent } from '../../src/agent';
import {
  GOAL_PROVIDER_AUTO_RETRIES,
  isRetryableProviderFailure,
  listSwitchableFailoverModels,
  resolveProviderRecovery,
} from '../../src/agent/provider-failover';
import { toKimiErrorPayload } from '../../src/errors';
import * as retry from '../../src/loop/retry';
import { testKaos } from '../fixtures/test-kaos';

describe('provider failover', () => {
  it('detects retryable provider failures', () => {
    const retryable = toKimiErrorPayload(new APIStatusError(500, 'server error', 'req-500'));
    expect(isRetryableProviderFailure(retryable)).toBe(true);

    const auth = toKimiErrorPayload(new APIStatusError(401, 'unauthorized', 'req-401'));
    expect(isRetryableProviderFailure(auth)).toBe(false);
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

  it('auto-retries before prompting the user', async () => {
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
    expect(sleepSpy).toHaveBeenCalledTimes(2);

    const requestQuestion = vi.mocked(agent.rpc!.requestQuestion!);
    requestQuestion.mockResolvedValue({
      [ 'The model provider returned a temporary error. How should we continue?' ]:
        'Switch to backup (Recommended)',
    });

    const third = await resolveProviderRecovery(agent, {
      error,
      turnId: 1,
      signal,
      state: { autoRetryCount: GOAL_PROVIDER_AUTO_RETRIES, userPrompted: false },
    });
    expect(third).toEqual({ type: 'switch', modelAlias: 'backup' });
    expect(requestQuestion).toHaveBeenCalledTimes(1);

    sleepSpy.mockRestore();
  });

  it('pauses when the user dismisses the failover question', async () => {
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
