import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { SUPERLIORA_PLATFORM } from '@superliora/oauth';
import type * as KosongModule from '@superliora/kosong';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLioraHarness, type Event, type LioraHarness } from '#/index';

import { TEST_IDENTITY } from './test-identity';

const fakeProviderState = vi.hoisted(() => ({
  calls: [] as Array<{
    readonly systemPrompt: string;
    readonly history: unknown;
  }>,
  providerConfigs: [] as unknown[],
  responseText: 'hello from fake provider',
}));

vi.mock('@superliora/kosong', async (importOriginal) => {
  const actual = await importOriginal<typeof KosongModule>();
  return {
    ...actual,
    createProvider: (config: unknown) => {
      fakeProviderState.providerConfigs.push(config);
      return {
        name: 'fake',
        modelName: 'fake-model',
        thinkingEffort: null,
        async generate(systemPrompt: string, _tools: unknown, history: unknown) {
          fakeProviderState.calls.push({ systemPrompt, history });
          // Response-language detection issues its own generate call with a
          // dedicated system prompt before the main agent turn. Return compact
          // JSON so the detector can parse a language preference.
          const detectionJson = detectResponseLanguageJson(systemPrompt, history);
          const responseText = detectionJson ?? fakeProviderState.responseText;
          return {
            id: 'fake-response',
            usage: {
              inputOther: 0,
              output: 1,
              inputCacheRead: 0,
              inputCacheCreation: 0,
            },
            finishReason: 'completed',
            rawFinishReason: 'stop',
            async *[Symbol.asyncIterator]() {
              yield { type: 'text', text: responseText };
            },
          };
        },
        withThinking() {
          return this;
        },
      };
    },
  };
});

const tempDirs: string[] = [];

beforeEach(() => {
  fakeProviderState.calls.length = 0;
  fakeProviderState.providerConfigs.length = 0;
  fakeProviderState.responseText = 'hello from fake provider';
});

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await removeTempDir(dir);
  }
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'kimi-sdk-prompt-'));
  tempDirs.push(dir);
  return dir;
}

async function removeTempDir(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOTEMPTY' && code !== 'EBUSY' && code !== 'EPERM') {
        throw error;
      }
      await delay(10);
    }
  }

  await rm(dir, { recursive: true, force: true });
}

describe('Session.prompt events', () => {
  it('persists sanitized prompt metadata without marking the title custom', async () => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    const harness = createLioraHarness({
      identity: TEST_IDENTITY,
      homeDir,
    });

    try {
      await configureFakeProvider(harness);
      const session = await harness.createSession({ id: 'ses_prompt_meta', workDir });
      const events: Event[] = [];
      const unsubscribe = session.onEvent((event) => {
        events.push(event);
      });

      let done = waitForEvent(session, (event) => event.type === 'turn.ended');
      await session.prompt('use api_key=secret-value for the request');
      await done;

      const statePath = join(session.summary!.sessionDir, 'state.json');
      const firstState = JSON.parse(await readFile(statePath, 'utf-8')) as Record<string, unknown>;
      expect(firstState['title']).toBe('use api_key=[redacted] for the request');
      expect(firstState['isCustomTitle']).toBe(false);
      expect(firstState['lastPrompt']).toBe('use api_key=[redacted] for the request');
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'session.meta.updated',
          title: 'use api_key=[redacted] for the request',
          patch: expect.objectContaining({
            isCustomTitle: false,
            lastPrompt: 'use api_key=[redacted] for the request',
          }),
        }),
      );

      events.length = 0;
      done = waitForEvent(session, (event) => event.type === 'turn.ended');
      await session.prompt('second prompt');
      await done;

      const secondState = JSON.parse(await readFile(statePath, 'utf-8')) as Record<string, unknown>;
      expect(secondState['title']).toBe('use api_key=[redacted] for the request');
      expect(secondState['isCustomTitle']).toBe(false);
      expect(secondState['lastPrompt']).toBe('second prompt');
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'session.meta.updated',
          patch: expect.objectContaining({
            lastPrompt: 'second prompt',
          }),
        }),
      );

      events.length = 0;
      done = waitForEvent(session, (event) => event.type === 'turn.ended');
      await session.prompt([{ type: 'image_url', imageUrl: { url: 'https://example.com/a.png' } }]);
      await done;
      unsubscribe();

      const mediaState = JSON.parse(await readFile(statePath, 'utf-8')) as Record<string, unknown>;
      expect(mediaState['title']).toBe('use api_key=[redacted] for the request');
      expect(mediaState['lastPrompt']).toBe('[image]');
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'session.meta.updated',
          patch: expect.objectContaining({
            lastPrompt: '[image]',
          }),
        }),
      );
    } finally {
      await harness.close();
    }
  });

  it('emits mapped turn events through Session.onEvent', async () => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    const harness = createLioraHarness({
      identity: TEST_IDENTITY,
      homeDir,
    });

    try {
      await configureFakeProvider(harness);
      const session = await harness.createSession({ id: 'ses_prompt_events', workDir });
      const events: Event[] = [];
      const done = waitForEvent(session, (event) => event.type === 'turn.ended');
      const unsubscribe = session.onEvent((event) => {
        events.push(event);
      });

      await session.prompt('hello');
      await done;
      unsubscribe();

      expect(events.some((event) => event.type === 'turn.started')).toBe(true);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'assistant.delta',
          sessionId: session.id,
          turnId: 0,
          delta: 'hello from fake provider',
        }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'turn.ended',
          sessionId: session.id,
          turnId: 0,
          reason: 'completed',
        }),
      );
      const mainCall = fakeProviderState.calls.find((call) =>
        call.systemPrompt.includes('You are SuperLiora CLI'),
      );
      expect(mainCall?.systemPrompt).toContain('You are SuperLiora CLI');
      expect(mainCall?.systemPrompt).toContain('Skill Runtime');
      expect(fakeProviderState.providerConfigs[0]).toMatchObject({
        type: 'kimi',
        defaultHeaders: expect.objectContaining({
          'X-Msh-Platform': SUPERLIORA_PLATFORM,
          'User-Agent': 'kimi-code-cli/0.0.0-test',
        }),
      });
      expect(existsSync(join(homeDir, 'device_id'))).toBe(true);
    } finally {
      await harness.close();
    }
  });

  it('locks detected response language and injects a fresh reminder', async () => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    const harness = createLioraHarness({
      identity: TEST_IDENTITY,
      homeDir,
    });

    try {
      await configureFakeProvider(harness);
      const session = await harness.createSession({ id: 'ses_response_language', workDir });

      let done = waitForEvent(session, (event) => event.type === 'turn.ended');
      await session.prompt('이 작업을 분석하고 다음 단계를 정리해줘.');
      await done;

      const statePath = join(session.summary!.sessionDir, 'state.json');
      const firstState = JSON.parse(await readFile(statePath, 'utf-8')) as {
        custom?: Record<string, unknown>;
      };
      expect(firstState.custom?.['responseLanguage']).toMatchObject({
        code: 'ko',
        label: 'Korean',
        source: 'detected',
        locked: true,
        updatedAt: expect.any(String),
      });
      const firstMainCall = mainAgentCall(0);
      expect(JSON.stringify(firstMainCall?.history)).toContain(
        '<response_language>',
      );
      expect(JSON.stringify(firstMainCall?.history)).toContain('Korean (ko)');

      done = waitForEvent(session, (event) => event.type === 'turn.ended');
      await session.prompt('continue with implementation details');
      await done;

      const secondState = JSON.parse(await readFile(statePath, 'utf-8')) as {
        custom?: Record<string, unknown>;
      };
      expect(secondState.custom?.['responseLanguage']).toMatchObject({
        code: 'ko',
        source: 'detected',
      });
      expect(JSON.stringify(mainAgentCall(1)?.history)).toContain('Korean (ko)');

      const fork = await harness.forkSession({
        id: session.id,
        forkId: 'ses_response_language_fork',
        title: 'Response Language Fork',
      });
      const forkState = JSON.parse(
        await readFile(join(fork.summary!.sessionDir, 'state.json'), 'utf-8'),
      ) as {
        custom?: Record<string, unknown>;
      };
      expect(forkState.custom?.['responseLanguage']).toMatchObject({
        code: 'ko',
        source: 'detected',
      });

      await session.close();
      const resumed = await harness.resumeSession({ id: 'ses_response_language' });
      done = waitForEvent(resumed, (event) => event.type === 'turn.ended');
      await resumed.prompt('continue after resume');
      await done;
      expect(JSON.stringify(mainAgentCall(2)?.history)).toContain('Korean (ko)');
    } finally {
      await harness.close();
    }
  });

  it('supports onEvent unsubscribe without touching runtime wire directly', async () => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    const harness = createLioraHarness({
      identity: TEST_IDENTITY,
      homeDir,
    });

    try {
      await configureFakeProvider(harness);
      const session = await harness.createSession({ id: 'ses_prompt_unsubscribe', workDir });
      const unsubscribedEvents: Event[] = [];
      const unsubscribe = session.onEvent((event) => {
        unsubscribedEvents.push(event);
      });
      unsubscribe();
      const done = waitForEvent(session, (event) => event.type === 'turn.ended');

      await session.prompt([{ type: 'text', text: 'hello' }]);
      await done;

      expect(unsubscribedEvents).toEqual([]);
    } finally {
      await harness.close();
    }
  });

  it('runs init through generateAgentsMd RPC as a subagent system trigger without prompt metadata updates', async () => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    const harness = createLioraHarness({
      identity: TEST_IDENTITY,
      homeDir,
    });

    try {
      await configureFakeProvider(harness);
      const session = await harness.createSession({ id: 'ses_init_rpc', workDir });
      const events: Event[] = [];
      const unsubscribe = session.onEvent((event) => {
        events.push(event);
      });

      await session.init();
      unsubscribe();

      const spawned = events.find((event) => event.type === 'subagent.spawned');
      expect(spawned).toMatchObject({
        type: 'subagent.spawned',
        sessionId: session.id,
        agentId: 'main',
        subagentName: 'coder',
        parentToolCallId: 'generate-agents-md',
      });
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'turn.started',
          sessionId: session.id,
          agentId: spawned?.type === 'subagent.spawned' ? spawned.subagentId : undefined,
          origin: { kind: 'system_trigger', name: 'subagent' },
        }),
      );
      expect(events).not.toContainEqual(
        expect.objectContaining({
          type: 'session.meta.updated',
        }),
      );
      expect(fakeProviderState.calls[0]?.history).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.arrayContaining([
              expect.objectContaining({
                text: expect.stringContaining('Task requirements:'),
              }),
            ]),
          }),
        ]),
      );

      const statePath = join(session.summary!.sessionDir, 'state.json');
      const state = JSON.parse(await readFile(statePath, 'utf-8')) as Record<string, unknown>;
      expect(state['lastPrompt']).toBeUndefined();
    } finally {
      await harness.close();
    }
  });

  it('starts btw through RPC as a forked subagent without prompt metadata updates', async () => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    const harness = createLioraHarness({
      identity: TEST_IDENTITY,
      homeDir,
    });

    try {
      await configureFakeProvider(harness);
      const session = await harness.createSession({ id: 'ses_btw_rpc', workDir });
      const events: Event[] = [];
      const unsubscribe = session.onEvent((event) => {
        events.push(event);
      });

      let done = waitForEvent(session, (event) => event.type === 'turn.ended');
      await session.prompt('main task context');
      await done;

      fakeProviderState.responseText = 'The main agent is working from the existing context.';
      events.length = 0;
      done = waitForEvent(
        session,
        (event) => event.type === 'turn.ended' && event.agentId !== 'main',
      );

      const agentId = await session.startBtw();
      await harness.withInteractiveAgent(agentId, () =>
        session.prompt('What are you working on right now?'),
      );
      await done;
      unsubscribe();
      expect(harness.interactiveAgentId).toBe('main');

      const started = events.find(
        (event) =>
          event.type === 'turn.started' &&
          event.agentId === agentId &&
          event.origin.kind === 'user',
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'turn.started',
          sessionId: session.id,
          agentId,
          origin: { kind: 'user' },
        }),
      );
      expect(started?.agentId).not.toBe('main');
      expect(events).not.toContainEqual(expect.objectContaining({ type: 'subagent.spawned' }));
      expect(events).not.toContainEqual(expect.objectContaining({ type: 'subagent.completed' }));
      expect(events).not.toContainEqual(expect.objectContaining({ type: 'subagent.failed' }));
      expect(events).not.toContainEqual(
        expect.objectContaining({
          type: 'session.meta.updated',
        }),
      );
      expect(mainAgentCall(1)?.systemPrompt).toBe(mainAgentCall(0)?.systemPrompt);
      const btwHistoryText = JSON.stringify(mainAgentCall(1)?.history);
      expect(btwHistoryText).toContain('main task context');
      expect(btwHistoryText).toContain('What are you working on right now?');

      const statePath = join(session.summary!.sessionDir, 'state.json');
      const state = JSON.parse(await readFile(statePath, 'utf-8')) as Record<string, unknown>;
      expect(state['lastPrompt']).toBe('main task context');
      expect(state['agents']).toMatchObject({ main: expect.any(Object) });
      expect(state['agents']).not.toHaveProperty(agentId);

      await harness.closeSession(session.id);
      const resumed = await harness.resumeSession({ id: session.id });
      const resumeState = resumed.getResumeState();
      expect(resumeState?.agents).toMatchObject({ main: expect.any(Object) });
      expect(resumeState?.agents).not.toHaveProperty(agentId);
      expect(resumeState?.sessionMetadata.agents).not.toHaveProperty(agentId);
    } finally {
      await harness.close();
    }
  });

  it('rejects empty prompt input', async () => {
    const homeDir = await makeTempDir();
    const workDir = await makeTempDir();
    const harness = createLioraHarness({
      identity: TEST_IDENTITY,
      homeDir,
    });

    try {
      const session = await harness.createSession({ id: 'ses_empty_prompt', workDir });
      await expect(session.prompt('   ')).rejects.toMatchObject({
        name: 'LioraError',
        code: 'request.prompt_input_empty',
      });
    } finally {
      await harness.close();
    }
  });
});

async function configureFakeProvider(harness: LioraHarness): Promise<void> {
  await harness.setConfig({
    providers: {
      local: {
        type: 'kimi',
        apiKey: 'sk-test',
      },
    },
    models: {
      'fake-model': {
        provider: 'local',
        model: 'fake-model',
        maxContextSize: 262144,
      },
    },
    defaultModel: 'fake-model',
  });
}

function waitForEvent(
  session: {
    onEvent(listener: (event: Event) => void): () => void;
  },
  predicate: (event: Event) => boolean,
): Promise<Event> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error('Timed out waiting for session event'));
    }, 1_000);
    const unsubscribe = session.onEvent((event) => {
      if (!predicate(event)) return;
      clearTimeout(timeout);
      unsubscribe();
      resolve(event);
    });
  });
}

/**
 * The response-language detector issues a dedicated `generate` call with its
 * own system prompt before the main agent turn. Return compact JSON the
 * detector can parse when this is that call, otherwise return `undefined` so
 * the fake provider streams the normal response text.
 */
function detectResponseLanguageJson(systemPrompt: string, history: unknown): string | undefined {
  if (!systemPrompt.startsWith('You detect the response language')) return undefined;
  const text = JSON.stringify(history);
  // Korean Hangul syllables (U+AC00–U+D7A3) mark the Korean detection case.
  const isKorean = /[\uac00-\ud7a3]/u.test(text);
  const result = isKorean
    ? { language_code: 'ko', language_name: 'Korean', explicit_override: false, confidence: 0.95 }
    : { language_code: 'en', language_name: 'English', explicit_override: false, confidence: 0.9 };
  return JSON.stringify(result);
}

/**
 * Index into only the main-agent generate calls, skipping the interleaved
 * response-language detection calls that now precede each turn.
 */
function mainAgentCall(
  index: number,
): { readonly systemPrompt: string; readonly history: unknown } | undefined {
  const mainCalls = fakeProviderState.calls.filter(
    (call) => !call.systemPrompt.startsWith('You detect the response language'),
  );
  return mainCalls[index];
}
