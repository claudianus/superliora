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
import { maybeTransformPromptForInterruptedWorkResume } from '../../src/ultrawork/interrupted-work-resume';

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

  it('matches explicit multilingual short resume phrases without an LLM', () => {
    for (const phrase of [
      'continue',
      '재개',
      '계속진행하라',
      '继续',
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
    ]) {
      const intent = matchExplicitResumePhrase(phrase);
      expect(shouldActOnResumeIntent(intent), phrase).toBe(true);
    }
    expect(matchExplicitResumePhrase('rewrite the auth module from scratch')).toBeUndefined();
    expect(matchExplicitResumePhrase('')).toBeUndefined();
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
});
