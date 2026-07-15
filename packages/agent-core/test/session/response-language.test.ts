import { describe, expect, it, vi } from 'vitest';

import type { ContentPart } from '@superliora/kosong';

import { buildResponseLanguageDirective } from '../../src/agent/injection/response-language';
import type { Session } from '../../src/session';
import { SessionAPIImpl } from '../../src/session/rpc';
import { detectResponseLanguageWithLlm } from '../../src/session/response-language-llm';
import {
  detectHostLocaleTag,
  normalizeResponseLanguageCode,
  resolveResponseLanguagePreference,
  responseLanguageLabelForCode,
  responseLanguagePreferenceFromHostLocale,
} from '../../src/session/response-language';

const NOW = new Date('2030-01-02T03:04:05.000Z');

describe('response language preference', () => {
  it('normalizes ISO language codes and resolves labels via Intl', () => {
    expect(normalizeResponseLanguageCode('KO')).toBe('ko');
    expect(normalizeResponseLanguageCode('english')).toBeUndefined();
    expect(responseLanguageLabelForCode('ko')).toBe('Korean');
    expect(responseLanguageLabelForCode('fr')).toBe('French');
  });

  it('detects host locale tags without language-specific hardcoding', () => {
    expect(detectHostLocaleTag({ LANG: 'ko_KR.UTF-8' })).toMatchObject({
      code: 'ko',
      label: 'Korean',
    });
    expect(detectHostLocaleTag({ LANG: 'fr_FR.UTF-8' })).toMatchObject({
      code: 'fr',
      label: 'French',
    });
    expect(detectHostLocaleTag({ LANG: 'C.UTF-8' })).toBeUndefined();
  });

  it('seeds a preference from host locale', () => {
    expect(
      responseLanguagePreferenceFromHostLocale({ LANG: 'de_DE.UTF-8' }, NOW),
    ).toMatchObject({
      code: 'de',
      label: 'German',
      source: 'locale',
      locked: true,
      updatedAt: NOW.toISOString(),
    });
  });

  it('resolves detected language via injected LLM detector', async () => {
    const detectWithLlm = vi.fn(async () => ({
      code: 'ko',
      label: 'Korean',
      explicit: false,
      confidence: 0.92,
    }));

    const resolved = await resolveResponseLanguagePreference(
      undefined,
      textInput('이 작업을 분석하고 다음 단계를 정리해줘.'),
      { detectWithLlm },
      NOW,
    );

    expect(resolved).toMatchObject({
      code: 'ko',
      label: 'Korean',
      source: 'detected',
      locked: true,
    });
    expect(detectWithLlm).toHaveBeenCalledOnce();
  });

  it('keeps a locked language unless the LLM reports an explicit override', async () => {
    const locked = await resolveResponseLanguagePreference(
      undefined,
      textInput('bonjour, explique ce repo'),
      {
        detectWithLlm: async () => ({
          code: 'fr',
          label: 'French',
          explicit: false,
          confidence: 0.9,
        }),
      },
      NOW,
    );

    const unchanged = await resolveResponseLanguagePreference(
      locked,
      textInput('continue with implementation details'),
      {
        detectWithLlm: async () => ({
          code: 'en',
          label: 'English',
          explicit: false,
          confidence: 0.8,
        }),
      },
      new Date('2030-01-02T03:05:00.000Z'),
    );
    expect(unchanged).toBe(locked);

    const overridden = await resolveResponseLanguagePreference(
      locked,
      textInput('reply in English from now on'),
      {
        detectWithLlm: async () => ({
          code: 'en',
          label: 'English',
          explicit: true,
          confidence: 0.95,
        }),
      },
      new Date('2030-01-02T03:06:00.000Z'),
    );
    expect(overridden).toMatchObject({
      code: 'en',
      label: 'English',
      source: 'explicit',
      locked: true,
    });
  });

  it('falls back to host locale when the LLM is uncertain', async () => {
    const resolved = await resolveResponseLanguagePreference(
      undefined,
      textInput('ok'),
      {
        env: { LANG: 'ko_KR.UTF-8' },
        detectWithLlm: async () => ({
          code: 'en',
          label: 'English',
          explicit: false,
          confidence: 0.2,
        }),
      },
      NOW,
    );

    expect(resolved).toMatchObject({
      code: 'ko',
      source: 'locale',
      locked: true,
    });
  });

  it('parses LLM detection JSON from generate output', async () => {
    const generate = vi.fn(async () => ({
      message: {
        content: [
          {
            type: 'text',
            text: '{"language_code":"ja","language_name":"Japanese","explicit_override":false,"confidence":0.88}',
          },
        ],
      },
    }));

    const detected = await detectResponseLanguageWithLlm(
      { generate: generate as never, provider: {} as never },
      { text: 'このリポジトリを調べてください' },
    );

    expect(detected).toMatchObject({
      code: 'ja',
      label: 'Japanese',
      explicit: false,
      confidence: 0.88,
    });
  });

  it('builds a strong directive that covers plans and AskUserQuestion', () => {
    const directive = buildResponseLanguageDirective({
      code: 'ko',
      label: 'Korean',
      source: 'detected',
      locked: true,
      updatedAt: NOW.toISOString(),
    });
    expect(directive).toContain('<response_language>');
    expect(directive).toContain('AskUserQuestion');
    expect(directive).toContain('plan files');
    expect(directive).not.toContain('한국어 강제');
    // Re-injected every few assistant turns — keep the lock compact.
    expect(directive.length).toBeLessThan(800);
  });

  it('updates main-agent steer metadata when the LLM reports an explicit override', async () => {
    const steer = vi.fn(async () => {});
    const session = fakeSession({
      steer,
      llmDetection: {
        code: 'en',
        label: 'English',
        explicit: true,
        confidence: 0.95,
      },
    });
    const api = new SessionAPIImpl(session as unknown as Session);

    await api.steer({
      agentId: 'main',
      input: textInput('reply in English from now on'),
    });

    expect((session.metadata.custom as Record<string, unknown>)['responseLanguage']).toMatchObject({
      code: 'en',
      label: 'English',
      source: 'explicit',
      locked: true,
      updatedAt: expect.any(String),
    });
    expect(session.writeMetadata).toHaveBeenCalledTimes(1);
    expect(steer).toHaveBeenCalledWith({ input: textInput('reply in English from now on') });
  });
});

function textInput(text: string): readonly ContentPart[] {
  return [{ type: 'text', text }];
}

function fakeSession(input: {
  readonly steer: (payload: { readonly input: readonly ContentPart[] }) => Promise<void>;
  readonly llmDetection?: {
    readonly code: string;
    readonly label: string;
    readonly explicit: boolean;
    readonly confidence: number;
  };
}) {
  const agent = {
    config: {
      provider: {},
    },
    generate: vi.fn(async () => ({
      message: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              language_code: input.llmDetection?.code ?? 'en',
              language_name: input.llmDetection?.label ?? 'English',
              explicit_override: input.llmDetection?.explicit ?? true,
              confidence: input.llmDetection?.confidence ?? 0.95,
            }),
          },
        ],
      },
    })),
    rpcMethods: {
      steer: input.steer,
    },
    // The steer path probes interrupted-work-resume context; stub the goal and
    // ultrawork controllers so it short-circuits without a real agent.
    goal: {
      getGoal: () => ({ goal: null }),
    },
    ultrawork: {
      getRun: () => null,
      getInterruptReason: () => null,
    },
  };

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
    ensureAgentResumed: vi.fn(async () => agent),
  };
}
