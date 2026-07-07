import { describe, expect, it, vi } from 'vitest';

import type { UltraworkRun } from '@superliora/protocol';
import { Agent } from '../../src/agent';
import { testKaos } from '../fixtures/test-kaos';
import {
  detectInterruptedWorkResumeIntentWithLlm,
  hasInterruptedWorkResumeContext,
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

  it('parses multilingual resume intent from the classifier response', async () => {
    const intent = await detectInterruptedWorkResumeIntentWithLlm(
      {
        generate: vi.fn(async () => ({
          message: {
            content: [
              {
                type: 'text',
                text: '{"should_resume":true,"confidence":0.93,"reason":"User asked to continue"}',
              },
            ],
          },
        })),
        provider: {} as never,
      },
      {
        text: '계속진행하라',
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
