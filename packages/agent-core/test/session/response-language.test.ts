import { describe, expect, it, vi } from 'vitest';

import type { ContentPart } from '@superliora/kosong';

import { buildResponseLanguageDirective } from '../../src/agent/injection/response-language';
import type { Session } from '../../src/session';
import { SessionAPIImpl } from '../../src/session/rpc';
import { detectResponseLanguageWithLlm } from '../../src/session/response-language-llm';
import {
  detectHostLocaleTag,
  mayRequestLanguageSwitch,
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
    expect(directive.length).toBeLessThan(700);
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

  it('skips LLM language detection when smart-auto has no concrete provider yet', async () => {
    const prompt = vi.fn(async () => {});
    const generate = vi.fn(async () => ({
      message: { content: [{ type: 'text', text: '{"language_code":"en"}' }] },
    }));
    const session = fakeSession({
      prompt,
      generate,
      hasProvider: false,
      providerThrows: true,
    });
    const api = new SessionAPIImpl(session as unknown as Session);
    const previousLang = process.env['LANG'];
    process.env['LANG'] = 'ko_KR.UTF-8';

    try {
      await expect(
        api.prompt({
          agentId: 'main',
          input: textInput('ㅎㅇ'),
        }),
      ).resolves.toBeUndefined();
    } finally {
      if (previousLang === undefined) delete process.env['LANG'];
      else process.env['LANG'] = previousLang;
    }

    expect(generate).not.toHaveBeenCalled();
    expect((session.metadata.custom as Record<string, unknown>)['responseLanguage']).toMatchObject({
      code: 'ko',
      source: 'locale',
      locked: true,
    });
    expect(prompt).toHaveBeenCalledWith({ input: textInput('ㅎㅇ') });
  });
});

describe('mayRequestLanguageSwitch', () => {
  it('reuses a locked language for ordinary same-language messages', () => {
    expect(mayRequestLanguageSwitch('한국어로 계속 진행해줘. 파일 수정하고 테스트 돌려봐.', 'ko')).toBe(
      false,
    );
    expect(mayRequestLanguageSwitch('please continue and run the tests', 'en')).toBe(false);
    expect(mayRequestLanguageSwitch('ok', 'en')).toBe(false);
  });

  it('catches explicit language demands', () => {
    expect(mayRequestLanguageSwitch('From now on answer in French.', 'en')).toBe(true);
    expect(mayRequestLanguageSwitch('이제부터는 영어로 답변해줘', 'ko')).toBe(true);
    expect(mayRequestLanguageSwitch('답변은 한국어로 해줘', 'en')).toBe(true);
    expect(mayRequestLanguageSwitch('/lang ko', 'en')).toBe(true);
    expect(mayRequestLanguageSwitch('日本語で返事して', 'en')).toBe(true);
    expect(mayRequestLanguageSwitch('다음부터 일본어로 말해줘', 'en')).toBe(true);
  });

  it('does not re-detect for plain same-script prose (only explicit demands move a lock)', () => {
    // Hangul prose while locked to English: no explicit demand → keep lock.
    expect(
      mayRequestLanguageSwitch('테스트가 실패하는 것 같아. 로그를 보여줄까? 그리고 이어서 계속 진행하자.', 'en'),
    ).toBe(false);
    // English prose while locked to Korean: same.
    expect(
      mayRequestLanguageSwitch('The build broke after my change, here is the stack trace of the failure.', 'ko'),
    ).toBe(false);
    // But a real demand inside prose still counts.
    expect(mayRequestLanguageSwitch('계속 진행하는데 이제 영어로 답변해줘', 'ko')).toBe(true);
    // Fenced code is stripped before any marker check (no false positive).
    expect(
      mayRequestLanguageSwitch('Please fix this: ```js\nconst hi = "안녕하세요";\n```', 'en'),
    ).toBe(false);
  });

  it('does not re-detect for code-only noise', () => {
    expect(mayRequestLanguageSwitch('`src/main.ts` L12 → L40', 'ko')).toBe(false);
    expect(mayRequestLanguageSwitch('npm run build -- --filter=@x/y', 'en')).toBe(false);
  });
});

  it('reuses the locked language without an LLM call on same-language follow-ups', async () => {
    const prompt = vi.fn(async () => {});
    const generate = vi.fn(async () => ({
      message: { content: [{ type: 'text', text: 'x' }] },
    }));
    const session = fakeSession({
      prompt,
      generate,
      seededLanguage: { code: 'en', label: 'English', source: 'explicit' },
    });
    const api = new SessionAPIImpl(session as unknown as Session);

    await api.prompt({
      agentId: 'main',
      input: textInput('please continue with the refactor and run the tests'),
    });

    // The preference is locked and nothing demands a switch — no detection call
    // (updatePromptMetadata may still persist metadata; only the LLM matters).
    expect(generate).not.toHaveBeenCalled();
    expect(prompt).toHaveBeenCalledOnce();
  });

  it('re-detects only when a follow-up message demands a different language', async () => {
    const prompt = vi.fn(async () => {});
    const generate = vi.fn(async () => ({
      message: {
        content: [
          {
            type: 'text',
            text: '{"language_code":"ko","language_name":"Korean","explicit_override":true,"confidence":0.95}',
          },
        ],
      },
    }));
    const session = fakeSession({
      prompt,
      generate,
      seededLanguage: { code: 'en', label: 'English', source: 'detected' },
    });
    const api = new SessionAPIImpl(session as unknown as Session);

    await api.prompt({
      agentId: 'main',
      input: textInput('이제부터는 한국어로 진행할게. 빌드가 깨져서 로그를 보여줄게.'),
    });

    expect(generate).toHaveBeenCalledOnce();
    expect((session.metadata.custom as Record<string, unknown>)['responseLanguage']).toMatchObject({
      code: 'ko',
      source: 'explicit',
      locked: true,
    });
  });

function textInput(text: string): readonly ContentPart[] {
  return [{ type: 'text', text }];
}

function fakeSession(input: {
  readonly steer?: (payload: { readonly input: readonly ContentPart[] }) => Promise<void>;
  readonly prompt?: (payload: { readonly input: readonly ContentPart[] }) => Promise<void>;
  readonly generate?: ReturnType<typeof vi.fn>;
  readonly hasProvider?: boolean;
  readonly providerThrows?: boolean;
  readonly llmDetection?: {
    readonly code: string;
    readonly label: string;
    readonly explicit: boolean;
    readonly confidence: number;
  };
  readonly seededLanguage?: { readonly code: string; readonly label: string; readonly source: string };
}) {
  const hasProvider = input.hasProvider ?? true;
  const agent = {
    config: {
      hasProvider,
      get provider() {
        if (input.providerThrows || !hasProvider) {
          throw new Error('Provider not set');
        }
        return {};
      },
    },
    generate:
      input.generate ??
      vi.fn(async () => ({
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
      steer: input.steer ?? (async () => {}),
      prompt: input.prompt ?? (async () => {}),
    },
    // The steer path probes interrupted-work-resume context; stub the goal
    // controller so it short-circuits without a real agent.
    goal: {
      getGoal: () => ({ goal: null }),
    },
  };

  const custom: Record<string, unknown> = {};
  if (input.seededLanguage !== undefined) {
    custom['responseLanguage'] = {
      code: input.seededLanguage.code,
      label: input.seededLanguage.label,
      source: input.seededLanguage.source,
      locked: true,
      updatedAt: NOW.toISOString(),
    };
  }
  return {
    metadata: {
      createdAt: '2030-01-01T00:00:00.000Z',
      updatedAt: '2030-01-01T00:00:00.000Z',
      title: 'New Session',
      isCustomTitle: false,
      agents: {},
      custom,
    },
    writeMetadata: vi.fn(async () => {}),
    ensureAgentResumed: vi.fn(async () => agent),
    options: { providerManager: undefined },
    rpc: { emitEvent: vi.fn(async () => {}) },
  };
}
