import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type * as KosongModule from '@superliora/kosong';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLioraHarness, type LioraError, type Event } from '#/index';

import { makeTempDir, removeTempDirs, waitForSDKEvent } from './session-runtime-helpers';
import { TEST_IDENTITY } from './test-identity';

vi.mock('@superliora/kosong', async (importOriginal) => {
  const actual = await importOriginal<typeof KosongModule>();
  return {
    ...actual,
    createProvider: () => ({
      name: 'fake',
      modelName: 'fake-model',
      thinkingEffort: null,
      async generate(
        systemPrompt: string,
        _tools: unknown,
        _history: unknown,
        options?: { readonly signal?: AbortSignal },
      ) {
        // Response-language detection runs a dedicated generate call before the
        // main turn; let it complete immediately so the turn can start (and
        // then block on the abort signal the test cancels).
        if (systemPrompt.startsWith('You detect the response language')) {
          return {
            id: 'fake-detection',
            usage: {
              inputOther: 0,
              output: 1,
              inputCacheRead: 0,
              inputCacheCreation: 0,
            },
            finishReason: 'completed',
            rawFinishReason: 'stop',
            async *[Symbol.asyncIterator]() {
              yield {
                type: 'text',
                text: JSON.stringify({
                  language_code: 'en',
                  language_name: 'English',
                  explicit_override: false,
                  confidence: 0.9,
                }),
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
      const started = waitForSDKEvent(session, (event) => event.type === 'turn.started');
      const ended = waitForSDKEvent(session, (event) => event.type === 'turn.ended');

      await session.prompt('start a turn that will be cancelled');
      const startedEvent = await started;
      await session.cancel();
      const endedEvent = await ended;
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
      const started = waitForSDKEvent(session, (event) => event.type === 'turn.started');
      const ended = waitForSDKEvent(session, (event) => event.type === 'turn.ended');

      await session.prompt('keep this turn active');
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
