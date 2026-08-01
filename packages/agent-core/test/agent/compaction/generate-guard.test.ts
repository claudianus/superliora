import { APITimeoutError } from '@superliora/kosong';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  COMPACTION_GENERATE_TIMEOUT_ENV,
  COMPACTION_WORKER_TIMEOUT_ENV,
  DEFAULT_COMPACTION_GENERATE_TIMEOUT_MS,
  DEFAULT_COMPACTION_STREAM_IDLE_MS,
  DEFAULT_COMPACTION_WORKER_TIMEOUT_MS,
  compactionGenerateOptions,
  resolveCompactionGenerateTimeoutMs,
  resolveCompactionWorkerTimeoutMs,
  runCompactionGenerate,
} from '../../../src/agent/compaction/pipeline/generate-guard';
import type { CompactionPipelineContext } from '../../../src/agent/compaction/pipeline/types';

describe('compaction generate-guard timeouts', () => {
  afterEach(() => {
    vi.useRealTimers();
    delete process.env[COMPACTION_GENERATE_TIMEOUT_ENV];
    delete process.env[COMPACTION_WORKER_TIMEOUT_ENV];
  });

  it('defaults generate / worker budgets and accepts positive env overrides', () => {
    expect(resolveCompactionGenerateTimeoutMs()).toBe(DEFAULT_COMPACTION_GENERATE_TIMEOUT_MS);
    expect(resolveCompactionWorkerTimeoutMs()).toBe(DEFAULT_COMPACTION_WORKER_TIMEOUT_MS);

    process.env[COMPACTION_GENERATE_TIMEOUT_ENV] = '15000';
    process.env[COMPACTION_WORKER_TIMEOUT_ENV] = '45000';
    expect(resolveCompactionGenerateTimeoutMs()).toBe(15_000);
    expect(resolveCompactionWorkerTimeoutMs()).toBe(45_000);

    // Invalid / non-positive env values fall back to defaults (never disable).
    process.env[COMPACTION_GENERATE_TIMEOUT_ENV] = '0';
    process.env[COMPACTION_WORKER_TIMEOUT_ENV] = 'nope';
    expect(resolveCompactionGenerateTimeoutMs()).toBe(DEFAULT_COMPACTION_GENERATE_TIMEOUT_MS);
    expect(resolveCompactionWorkerTimeoutMs()).toBe(DEFAULT_COMPACTION_WORKER_TIMEOUT_MS);

    expect(resolveCompactionGenerateTimeoutMs(12_345)).toBe(12_345);
  });

  it('attaches a tighter stream idle budget on generate options', () => {
    const ctx = {
      compactionModelAlias: 'cheap-fast',
    } as CompactionPipelineContext;
    const signal = new AbortController().signal;
    expect(compactionGenerateOptions(ctx, signal)).toEqual({
      signal,
      runtimeModelAlias: 'cheap-fast',
      streamIdleTimeoutMs: DEFAULT_COMPACTION_STREAM_IDLE_MS,
    });
  });

  it('converts a hung generate into APITimeoutError so classical fallback can run', async () => {
    vi.useFakeTimers();
    const generate = vi.fn((_provider, _system, _tools, _messages, _callbacks, options) => {
      return new Promise((_resolve, reject) => {
        const onAbort = (): void => {
          const err = new Error('The operation was aborted.');
          err.name = 'AbortError';
          reject(err);
        };
        if (options?.signal?.aborted) {
          onAbort();
          return;
        }
        options?.signal?.addEventListener('abort', onAbort, { once: true });
      });
    });
    const ctx = {
      compactionModelAlias: undefined,
      agent: {
        config: { systemPrompt: 'sys' },
        generate,
        emitEvent: vi.fn(),
      },
    } as unknown as CompactionPipelineContext;

    const pending = runCompactionGenerate(ctx, new AbortController().signal, {
      provider: { name: 'test', modelName: 'm' } as never,
      messages: [],
      streamMeta: { phase: 'summarizing', streamKind: 'summary' },
      timeoutMs: 25,
    });
    const assertion = expect(pending).rejects.toBeInstanceOf(APITimeoutError);
    await vi.advanceTimersByTimeAsync(30);
    await assertion;
    expect(generate).toHaveBeenCalledOnce();
  });

  it('propagates a real caller abort without rewriting it as a timeout', async () => {
    const caller = new AbortController();
    const generate = vi.fn((_provider, _system, _tools, _messages, _callbacks, options) => {
      return new Promise((_resolve, reject) => {
        const onAbort = (): void => {
          const err = new Error('caller cancelled');
          err.name = 'AbortError';
          reject(err);
        };
        options?.signal?.addEventListener('abort', onAbort, { once: true });
      });
    });
    const ctx = {
      agent: {
        config: { systemPrompt: 'sys' },
        generate,
        emitEvent: vi.fn(),
      },
    } as unknown as CompactionPipelineContext;

    const pending = runCompactionGenerate(ctx, caller.signal, {
      provider: { name: 'test', modelName: 'm' } as never,
      messages: [],
      streamMeta: { phase: 'summarizing', streamKind: 'summary' },
      timeoutMs: 60_000,
    });
    caller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
