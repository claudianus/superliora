import { describe, expect, it, vi } from 'vitest';

import type { UltraworkRun } from '@superliora/protocol';
import { Agent } from '../../src/agent';
import { testKaos } from '../fixtures/test-kaos';
import {
  detectInterruptedWorkResumeIntentWithLlm,
  hasInterruptedWorkResumeContext,
  matchExplicitResumePhrase,
  shouldActOnResumeIntent,
} from '../../src/ultrawork/resume-intent-llm';
import {
  buildResumeWithSteering,
  maybeTransformPromptForInterruptedWorkResume,
} from '../../src/ultrawork/interrupted-work-resume';
import { CONTINUE_GOAL_INPUT } from '../../src/ultrawork/resume-intent-llm';

describe('interrupted work resume intent', () => {
  it('detects resumable context from paused goals and blocked ultrawork runs', () => {
    expect(
      hasInterruptedWorkResumeContext({
        goal: {
          goalId: 'g1',
          objective: 'Ship',
          status: 'paused',
          turnsUsed: 1,
          tokensUsed: 0,
          wallClockMs: 0,
          budget: {
            turnBudget: null,
            tokenBudget: null,
            wallClockBudgetMs: null,
            overBudget: false,
            remainingTurns: null,
            remainingTokens: null,
            remainingWallClockMs: null,
            tokenBudgetReached: false,
            turnBudgetReached: false,
            wallClockBudgetReached: false,
          },
        },
        ultraworkRun: null,
      }),
    ).toBe(true);
    expect(
      hasInterruptedWorkResumeContext({
        goal: null,
        ultraworkRun: {
          id: 'run-1',
          objective: 'Ship',
          status: 'blocked',
          stage: 'verify',
          createdAt: '2026-07-06T00:00:00.000Z',
          updatedAt: '2026-07-06T00:05:00.000Z',
        },
      }),
    ).toBe(true);
    expect(
      hasInterruptedWorkResumeContext({
        goal: null,
        ultraworkRun: {
          id: 'run-1',
          objective: 'Ship',
          status: 'running',
          stage: 'verify',
          createdAt: '2026-07-06T00:00:00.000Z',
          updatedAt: '2026-07-06T00:05:00.000Z',
        },
      }),
    ).toBe(false);
  });



  it('detects soft interrupt reason on a still-running ultrawork run', () => {
    expect(
      hasInterruptedWorkResumeContext({
        goal: null,
        ultraworkRun: {
          id: 'run-1',
          objective: 'Ship',
          status: 'running',
          stage: 'verify',
          createdAt: '2026-07-06T00:00:00.000Z',
          updatedAt: '2026-07-06T00:05:00.000Z',
        },
        ultraworkInterruptReason: 'Paused after agent resume',
      }),
    ).toBe(true);
    expect(
      hasInterruptedWorkResumeContext({
        goal: null,
        ultraworkRun: {
          id: 'run-1',
          objective: 'Ship',
          status: 'running',
          stage: 'verify',
          createdAt: '2026-07-06T00:00:00.000Z',
          updatedAt: '2026-07-06T00:05:00.000Z',
        },
      }),
    ).toBe(false);
  });

  it('detects soft mid-run resume from pending WorkGraph nodes without interrupt reason', () => {
    expect(
      hasInterruptedWorkResumeContext({
        goal: null,
        ultraworkRun: {
          id: 'run-soft-mid',
          objective: 'Ship',
          status: 'running',
          stage: 'integrate',
          createdAt: '2026-07-06T00:00:00.000Z',
          updatedAt: '2026-07-06T00:05:00.000Z',
          workGraph: {
            id: 'run-soft-mid:work_graph',
            runId: 'run-soft-mid',
            rootGoal: 'Ship',
            nodes: [
              {
                id: 'node-1',
                title: 'Implement API',
                stage: 'integrate',
                status: 'running',
              },
            ],
          },
        },
      }),
    ).toBe(true);
    expect(
      hasInterruptedWorkResumeContext({
        goal: null,
        ultraworkRun: {
          id: 'run-soft-done',
          objective: 'Ship',
          status: 'running',
          stage: 'learn',
          createdAt: '2026-07-06T00:00:00.000Z',
          updatedAt: '2026-07-06T00:05:00.000Z',
          workGraph: {
            id: 'run-soft-done:work_graph',
            runId: 'run-soft-done',
            rootGoal: 'Ship',
            nodes: [
              {
                id: 'node-1',
                title: 'Done node',
                stage: 'learn',
                status: 'done',
              },
            ],
          },
        },
      }),
    ).toBe(false);
  });

  it('matches explicit multilingual short resume phrases without an LLM', () => {
    for (const phrase of [
      'continue',
      '재개',
      '계속진행하라',
      '继续',
      '继续做',
      '接着干',
      'keep going',
      '이어서 해 주세요',
      'go on please',
      'carry on',
      'keep at it',
      '계속 해주세요',
      'pick up where we left off',
      '이어서 작업해줘',
      'continue working',
      'resume the work',
      'keep working',
      '다시 시작해',
      '続けて',
      '続行',
      '再開してください',
      'continuar',
      'sigue adelante',
      'weiter',
      'fortsetzen',
      'continuer',
      'riprendi',
      'prosseguir',
      'продолжай',
      'давай дальше',
      // Curly apostrophe should normalize to ASCII for FR resume phrases.
      "s\u2019il vous plaît continue",
      "s\u2019il te plaît continue",
    ]) {
      const intent = matchExplicitResumePhrase(phrase);
      expect(shouldActOnResumeIntent(intent), phrase).toBe(true);
    }
    expect(matchExplicitResumePhrase('rewrite the auth module from scratch')).toBeUndefined();
    expect(matchExplicitResumePhrase('')).toBeUndefined();
  });

  it('matches resume prefixes that carry short steering without an LLM', () => {
    for (const phrase of [
      'continue, and also fix the auth tests',
      'continue — focus on the failing suite',
      'resume: finish the PR',
      'keep going, ignore the lint noise',
      'go on please and run the tests',
      '이어서 작업해줘. 그리고 테스트도 돌려',
      '계속 해줘, 이번엔 빌드부터',
      '继续做, 先跑测试',
      '続けて テストを回して',
      'continuar, arregla los tests',
      'weiter, und fix die tests',
      'продолжай, почини тесты',
    ]) {
      const intent = matchExplicitResumePhrase(phrase);
      expect(shouldActOnResumeIntent(intent), phrase).toBe(true);
      expect(intent?.reason, phrase).toMatch(/steering|resume/i);
    }
    // Free-form tasks that only mention "continue" later must not match.
    expect(
      matchExplicitResumePhrase('please rewrite auth and continue later'),
    ).toBeUndefined();
  });

  it('resumes blocked ultrawork from an explicit phrase without a provider', async () => {
    const agent = new Agent({ kaos: testKaos });
    agent.ultrawork.create({
      id: 'run-resume-heuristic',
      objective: 'Ship game',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: '.superliora/evidence/ultrawork-runs/run-resume-heuristic',
        workDir: '/tmp',
      },
    });
    await agent.ultrawork.markInterrupted({ reason: 'Paused after provider API error: 500' });

    const transformed = await maybeTransformPromptForInterruptedWorkResume(agent, 'continue');
    expect(transformed?.reason).toContain('Explicit short resume phrase');
    expect(transformed?.promptText.length).toBeGreaterThan(20);
    expect(agent.ultrawork.getRun()?.status).toBe('running');
  });

  it('resumes soft-interrupted still-running ultrawork from an explicit phrase', async () => {
    const agent = new Agent({ kaos: testKaos });
    const run = agent.ultrawork.create({
      id: 'run-resume-soft',
      objective: 'Ship game',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: '.superliora/evidence/ultrawork-runs/run-resume-soft',
        workDir: '/tmp',
      },
    });
    // Soft interrupt: keep status running but attach an interrupt reason
    // (e.g. mid-run agent replay / crash recovery before markBlocked).
    agent.ultrawork.applyMirrorRunQuiet({
      run: { ...run, status: 'running' },
      interruptReason: 'Paused after agent resume',
    });
    expect(agent.ultrawork.getRun()?.status).toBe('running');
    expect(agent.ultrawork.getInterruptReason()).toBe('Paused after agent resume');

    const transformed = await maybeTransformPromptForInterruptedWorkResume(agent, '이어서 작업해줘');
    expect(transformed?.reason).toMatch(/resume|Explicit/i);
    expect(transformed?.promptText.length).toBeGreaterThan(20);
    expect(agent.ultrawork.getRun()?.status).toBe('running');
    // Soft interrupt reason should be cleared after successful resume.
    expect(agent.ultrawork.getInterruptReason()).toBeUndefined();
  });

  it('resumes soft mid-run ultrawork with pending WorkGraph and no interrupt reason', async () => {
    const agent = new Agent({ kaos: testKaos });
    const run = agent.ultrawork.create({
      id: 'run-resume-soft-graph',
      objective: 'Ship game',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: '.superliora/evidence/ultrawork-runs/run-resume-soft-graph',
        workDir: '/tmp',
      },
    });
    // Soft mid-run: still running, unfinished WorkGraph nodes, no interruptReason
    // (e.g. session restore before interrupt metadata is mirrored).
    agent.ultrawork.applyMirrorRunQuiet({
      run: {
        ...run,
        status: 'running',
        stage: 'integrate',
        workGraph: {
          id: 'run-resume-soft-graph:work_graph',
          runId: 'run-resume-soft-graph',
          rootGoal: 'Ship game',
          nodes: [
            {
              id: 'node-1',
              title: 'Implement API',
              stage: 'integrate',
              status: 'running',
            },
          ],
        },
      },
    });
    expect(agent.ultrawork.getRun()?.status).toBe('running');
    expect(agent.ultrawork.getInterruptReason()).toBeUndefined();

    const transformed = await maybeTransformPromptForInterruptedWorkResume(agent, 'continue');
    expect(transformed?.reason).toMatch(/resume|Explicit/i);
    expect(transformed?.promptText.length).toBeGreaterThan(20);
    expect(transformed?.promptText).toMatch(/ultrawork_recovery|Continue from where you left off/i);
    expect(agent.ultrawork.getRun()?.status).toBe('running');
  });

  it('parses multilingual resume intent from the classifier response', async () => {
    const intent = await detectInterruptedWorkResumeIntentWithLlm(
      {
        generate: vi.fn(async () => ({
          id: 'gen_test',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: '{"should_resume":true,"confidence":0.93,"reason":"User asked to continue"}',
              },
            ],
          },
          usage: null,
          finishReason: 'stop',
          rawFinishReason: 'stop',
        })) as never,
        provider: {} as never,
      },
      {
        text: '방금 멈춘 작업 이어서 마무리해줘',
        context: {
          goal: null,
          ultraworkRun: {
            id: 'run-1',
            objective: 'Ship game',
            status: 'blocked',
            stage: 'verify',
            createdAt: '2026-07-06T00:00:00.000Z',
            updatedAt: '2026-07-06T00:05:00.000Z',
          },
          ultraworkInterruptReason: 'Paused after provider API error: 500',
        },
      },
    );
    expect(intent).toEqual({
      shouldResume: true,
      confidence: 0.93,
      reason: 'User asked to continue',
    });
    expect(shouldActOnResumeIntent(intent)).toBe(true);
  });

  it('resumes blocked ultrawork with the recovery prompt when intent is confident', async () => {
    const agent = new Agent({ kaos: testKaos });
    agent.ultrawork.create({
      id: 'run-resume-intent',
      objective: 'Ship game',
      activation: {
        source: 'manual',
        replaceGoal: false,
        evidenceRoot: '.superliora/evidence/ultrawork-runs/run-resume-intent',
        workDir: '/tmp',
      },
    });
    await agent.ultrawork.markInterrupted({ reason: 'Paused after provider API error: 500' });

    const generate = vi.fn(async () => ({
      message: {
        content: [
          {
            type: 'text',
            text: '{"should_resume":true,"confidence":0.95,"reason":"Continue interrupted work"}',
          },
        ],
      },
    }));
    Object.defineProperty(agent.config, 'provider', {
      value: {},
      configurable: true,
    });
    Object.defineProperty(agent, 'generate', {
      value: generate,
      configurable: true,
    });

    const transformed = await maybeTransformPromptForInterruptedWorkResume(agent, 'keep going');
    expect(transformed?.promptText).toContain('<ultrawork_recovery>');
    expect(agent.ultrawork.getRun()?.status).toBe('running');
  });

  it('does not resume when the classifier declines', async () => {
    const agent = new Agent({ kaos: testKaos });
    await agent.goal.createGoal({ objective: 'Ship game' });
    await agent.goal.pauseActiveGoal({ reason: 'Paused after provider API error: 500' });

    Object.defineProperty(agent.config, 'provider', {
      value: {},
      configurable: true,
    });
    Object.defineProperty(agent, 'generate', {
      value: vi.fn(async () => ({
        message: {
          content: [
            {
              type: 'text',
              text: '{"should_resume":false,"confidence":0.91,"reason":"User requested a new task"}',
            },
          ],
        },
      })),
      configurable: true,
    });

    const transformed = await maybeTransformPromptForInterruptedWorkResume(
      agent,
      'instead build a todo app',
    );
    expect(transformed).toBeUndefined();
    expect(agent.goal.getGoal().goal?.status).toBe('paused');
  });

  it('falls back to CONTINUE_GOAL_INPUT when recoveryPrompt is empty', () => {
    const empty = buildResumeWithSteering('', 'continue');
    expect(empty).toContain(CONTINUE_GOAL_INPUT);
    expect(empty).toContain('## User steering for this resume');
    expect(empty).toContain('continue');
    expect(empty.startsWith('\n\n## User steering')).toBe(false);

    const whitespaceOnly = buildResumeWithSteering('   \n  ', 'keep going');
    expect(whitespaceOnly).toContain(CONTINUE_GOAL_INPUT);
    expect(whitespaceOnly).toContain('keep going');

    const durable = buildResumeWithSteering('<ultrawork_recovery>\nok', 'continue');
    expect(durable).toContain('<ultrawork_recovery>');
    expect(durable).not.toContain(CONTINUE_GOAL_INPUT);
  });
});
