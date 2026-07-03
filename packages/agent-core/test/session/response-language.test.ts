import { describe, expect, it, vi } from 'vitest';

import type { ContentPart } from '@moonshot-ai/kosong';

import type { Session } from '../../src/session';
import { SessionAPIImpl } from '../../src/session/rpc';
import {
  detectResponseLanguage,
  resolveResponseLanguagePreference,
} from '../../src/session/response-language';

const NOW = new Date('2030-01-02T03:04:05.000Z');

describe('response language preference', () => {
  it('detects Korean prose while ignoring fenced code and inline code', () => {
    const text = [
      '```ts',
      'const responseLanguage = "English";',
      'function renderOutput() { return "hello"; }',
      '```',
      '이 작업을 분석하고 다음 단계를 정리해줘. `const name = "value"`는 그대로 둬.',
    ].join('\n');

    expect(detectResponseLanguage(text)).toBe('ko');
  });

  it('does not lock a language for short ambiguous prompts', () => {
    expect(detectResponseLanguage('ok')).toBeUndefined();
    expect(detectResponseLanguage('네')).toBeUndefined();
  });

  it('locks the first detected language until an explicit override appears', () => {
    const initial = resolveResponseLanguagePreference(
      undefined,
      textInput('이 작업을 분석하고 다음 단계를 정리해줘.'),
      NOW,
    );
    expect(initial).toMatchObject({
      code: 'ko',
      label: 'Korean',
      source: 'detected',
      locked: true,
      updatedAt: NOW.toISOString(),
    });

    const unchanged = resolveResponseLanguagePreference(
      initial,
      textInput('continue with implementation details'),
      new Date('2030-01-02T03:05:00.000Z'),
    );
    expect(unchanged).toBe(initial);

    const overridden = resolveResponseLanguagePreference(
      initial,
      textInput('앞으로 영어로 답해'),
      new Date('2030-01-02T03:06:00.000Z'),
    );
    expect(overridden).toMatchObject({
      code: 'en',
      label: 'English',
      source: 'explicit',
      locked: true,
    });
  });

  it('updates main-agent steer metadata when the user explicitly changes language', async () => {
    const steer = vi.fn(async () => {});
    const session = fakeSession({ steer });
    const api = new SessionAPIImpl(session as unknown as Session);

    await api.steer({
      agentId: 'main',
      input: textInput('앞으로 영어로 답해'),
    });

    expect((session.metadata.custom as Record<string, unknown>)['responseLanguage']).toMatchObject({
      code: 'en',
      label: 'English',
      source: 'explicit',
      locked: true,
      updatedAt: expect.any(String),
    });
    expect(session.writeMetadata).toHaveBeenCalledTimes(1);
    expect(steer).toHaveBeenCalledWith({ input: textInput('앞으로 영어로 답해') });
  });
});

function textInput(text: string): readonly ContentPart[] {
  return [{ type: 'text', text }];
}

function fakeSession(input: {
  readonly steer: (payload: { readonly input: readonly ContentPart[] }) => Promise<void>;
}) {
  return {
    metadata: {
      createdAt: '2030-01-01T00:00:00.000Z',
      updatedAt: '2030-01-01T00:00:00.000Z',
      title: 'New Session',
      isCustomTitle: false,
      agents: {},
      custom: {},
    },
    writeMetadata: vi.fn(async () => {}),
    ensureAgentResumed: vi.fn(async () => ({
      rpcMethods: {
        steer: input.steer,
      },
    })),
  };
}
