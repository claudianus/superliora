import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type * as KosongModule from '@superliora/kosong';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLioraHarness, type LioraError, type Event } from '#/index';

import { makeTempDir, removeTempDirs, waitForSDKEvent } from './session-runtime-helpers';
import { TEST_IDENTITY } from './test-identity';

const delayedStream = vi.hoisted(() => ({
  enabled: false,
  calls: 0,
  entered: Promise.withResolvers<void>(),
  cleaning: Promise.withResolvers<void>(),
  release: Promise.withResolvers<void>(),
}));

beforeEach(() => {
  delayedStream.enabled = false;
  delayedStream.calls = 0;
  delayedStream.entered = Promise.withResolvers<void>();
  delayedStream.cleaning = Promise.withResolvers<void>();
  delayedStream.release = Promise.withResolvers<void>();
});

vi.mock('@superliora/kosong', async (importOriginal) => {
  const actual = await importOriginal<typeof KosongModule>();
  return {
    ...actual,
    createProvider: () => ({
      name: 'fake',
      modelName: 'fake-model',
      thinkingEffort: null,
      async generate(
        _systemPrompt: string,
        _tools: unknown,
        _history: unknown,
        options?: { readonly signal?: AbortSignal },
      ) {
        delayedStream.calls += 1;
        if (delayedStream.enabled) {
          return {
            id: 'delayed-stream',
            usage: { inputOther: 1, output: 0, inputCacheRead: 0, inputCacheCreation: 0 },
            finishReason: 'completed',
            rawFinishReason: 'stop',
            [Symbol.asyncIterator]() {
              return {
                async next(): Promise<IteratorResult<never>> {
                  delayedStream.entered.resolve();
                  try {
                    await waitForAbort(options?.signal);
                    throwAbortError();
                  } finally {
                    delayedStream.cleaning.resolve();
                    await delayedStream.release.promise;
                  }
                },
              };
            },
          };
        }
        await waitForAbort(options?.signal);
        throwAbortError();
      },
      withThinking() {
        return this;
      },
    }),
  };
});

const tempDirs: string[] = [];

afterEach(async () => {
  await removeTempDirs(tempDirs);
});

describe('Session.cancel', () => {
  it('cancels an active streaming turn and emits turn_ended(cancelled)', async () => {
    const homeDir = await makeTempDir(tempDirs, 'kimi-sdk-cancel-home-');
    const workDir = await makeTempDir(tempDirs, 'kimi-sdk-cancel-work-');
    await writeFakeModelConfig(homeDir);
    const harness = createLioraHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      const session = await harness.createSession({ id: 'ses_cancel_active_turn', workDir });
      const events: Event[] = [];
      const unsubscribe = session.onEvent((event) => {
        events.push(event);
      });
      const started = waitForSDKEvent(session, (event) => event.type === 'turn.started', 8_000);
      const ended = waitForSDKEvent(session, (event) => event.type === 'turn.ended', 8_000);

      const promptPromise = session.prompt('start a turn that will be cancelled');
      const startedEvent = await started;
      await session.cancel();
      const endedEvent = await ended;
      await promptPromise.catch(() => undefined);
      unsubscribe();

      expect(startedEvent).toMatchObject({
        type: 'turn.started',
        sessionId: session.id,
      });
      expect(endedEvent).toMatchObject({
        type: 'turn.ended',
        sessionId: session.id,
        turnId: startedEvent.type === 'turn.started' ? startedEvent.turnId : undefined,
        reason: 'cancelled',
      });
      expect(events).toContainEqual(expect.objectContaining({ type: 'turn.started' }));
      expect(events).toContainEqual(expect.objectContaining({ type: 'turn.ended' }));
    } finally {
      await harness.close();
    }
  });

  it('joins delayed stream cleanup for concurrent closes without running buffered steer', async () => {
    const homeDir = await makeTempDir(tempDirs, 'sdk-close-join-home-');
    const workDir = await makeTempDir(tempDirs, 'sdk-close-join-work-');
    await writeFakeModelConfig(homeDir);
    const harness = createLioraHarness({ homeDir, identity: TEST_IDENTITY });
    delayedStream.enabled = true;
    try {
      const session = await harness.createSession({ id: 'ses_close_delayed_stream', workDir });
      const events: Event[] = [];
      session.onEvent((event) => events.push(event));
      const prompt = session.prompt('keep the stream open');
      await delayedStream.entered.promise;
      await prompt;
      await session.steer('buffered work must not launch during shutdown');
      let finishedCloses = 0;
      const firstClose = session.close().then(() => { finishedCloses += 1; });
      const secondClose = session.close().then(() => { finishedCloses += 1; });
      await delayedStream.cleaning.promise;
      await Promise.resolve();
      expect(finishedCloses).toBe(0);
      expect(events.filter((event) => event.type === 'turn.ended')).toEqual([]);
      delayedStream.release.resolve();
      await Promise.all([firstClose, secondClose]);
      expect(finishedCloses).toBe(2);
      expect(delayedStream.calls).toBe(1);
      expect(harness.getSession(session.id)).toBeUndefined();
      await expect(session.prompt('after close')).rejects.toMatchObject({ code: 'session.closed' });
    } finally {
      delayedStream.release.resolve();
      await harness.close();
    }
  });

  it('rejects manual compaction on an empty session with compaction.unable', async () => {
    const homeDir = await makeTempDir(tempDirs, 'kimi-sdk-cancel-compact-home-');
    const workDir = await makeTempDir(tempDirs, 'kimi-sdk-cancel-compact-work-');
    await writeFakeModelConfig(homeDir);
    const harness = createLioraHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      const session = await harness.createSession({ id: 'ses_cancel_compaction', workDir });

      await expect(session.compact({ instruction: 'Keep the compact test pending.' })).rejects.toMatchObject({
        name: 'LioraError',
        code: 'compaction.unable',
      } satisfies Partial<LioraError>);
    } finally {
      await harness.close();
    }
  });

  it('rejects after the session is closed', async () => {
    const homeDir = await makeTempDir(tempDirs, 'kimi-sdk-cancel-home-');
    const workDir = await makeTempDir(tempDirs, 'kimi-sdk-cancel-work-');
    const harness = createLioraHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      const session = await harness.createSession({ id: 'ses_cancel_closed', workDir });
      await session.close();

      await expect(session.cancel()).rejects.toMatchObject({
        name: 'LioraError',
        code: 'session.closed',
      } satisfies Partial<LioraError>);
      await expect(session.cancelCompaction()).rejects.toMatchObject({
        name: 'LioraError',
        code: 'session.closed',
      } satisfies Partial<LioraError>);
    } finally {
      await harness.close();
    }
  });
});

describe('LioraHarness.forkSession', () => {
  it('rejects while the source session has an active turn', async () => {
    const homeDir = await makeTempDir(tempDirs, 'kimi-sdk-fork-active-home-');
    const workDir = await makeTempDir(tempDirs, 'kimi-sdk-fork-active-work-');
    await writeFakeModelConfig(homeDir);
    const harness = createLioraHarness({ homeDir, identity: TEST_IDENTITY });

    try {
      const session = await harness.createSession({ id: 'ses_fork_active_turn', workDir });
      const started = waitForSDKEvent(session, (event) => event.type === 'turn.started', 8_000);
      const ended = waitForSDKEvent(session, (event) => event.type === 'turn.ended', 8_000);

      const promptPromise = session.prompt('keep this turn active');
      await started;
      try {
        await expect(
          harness.forkSession({
            id: session.id,
            forkId: 'ses_fork_active_child',
          }),
        ).rejects.toMatchObject({
          name: 'LioraError',
          code: 'session.fork_active_turn',
        } satisfies Partial<LioraError>);
      } finally {
        await session.cancel().catch(() => undefined);
        await ended.catch(() => undefined);
        await promptPromise.catch(() => undefined);
      }
    } finally {
      await harness.close();
    }
  });
});

async function writeFakeModelConfig(homeDir: string): Promise<void> {
  await writeFile(
    join(homeDir, 'config.toml'),
    `
default_model = "fake-model"

[providers.local]
type = "kimi"
base_url = "https://example.test/v1"
api_key = "sk-test"

[models.fake-model]
provider = "local"
model = "fake-model"
max_context_size = 1000
`,
    'utf-8',
  );
}

function waitForAbort(signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted === true) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    signal?.addEventListener(
      'abort',
      () => {
        resolve();
      },
      { once: true },
    );
  });
}

function throwAbortError(): never {
  throw new DOMException('The operation was aborted.', 'AbortError');
}
