import { describe, expect, it } from 'vitest';

import type { Agent } from '../../src/agent';
import { PremiumQualityInjector } from '../../src/agent/injection/premium-quality';
import {
  PREMIUM_QUALITY_CODE_FULL_GUIDANCE,
  PREMIUM_QUALITY_CODE_SPARSE_GUIDANCE,
  PREMIUM_QUALITY_FULL_GUIDANCE,
  PREMIUM_QUALITY_SPARSE_GUIDANCE,
} from '../../src/premium-quality/guidance';

function premiumAgent(
  enabled: boolean,
  options: { goalObjective?: string; runObjective?: string } = {},
): Agent {
  const history: unknown[] = [];
  let isEnabled = enabled;
  return {
    premiumQuality: {
      isEnabled: () => isEnabled,
      setEnabled: (next: boolean) => {
        isEnabled = next;
      },
    },
    goal: {
      getGoal: () => ({
        goal:
          options.goalObjective === undefined
            ? null
            : {
                goalId: 'g1',
                objective: options.goalObjective,
                status: 'active',
              },
      }),
    },
    ultrawork: {
      getRun: () =>
        options.runObjective === undefined
          ? null
          : {
              id: 'run-1',
              objective: options.runObjective,
              status: 'running',
              stage: 'intake',
            },
    },
    context: {
      history,
      appendSystemReminder: (content: string) => {
        history.push({
          role: 'user',
          content: [{ type: 'text', text: content }],
          origin: { kind: 'injection', variant: 'premium_quality' },
        });
      },
    },
  } as unknown as Agent;
}

function history(agent: Agent): Array<{ role: string; content?: ReadonlyArray<{ text?: string }>; origin?: { kind: string } }> {
  return agent.context.history as unknown as Array<{
    role: string;
    content?: ReadonlyArray<{ text?: string }>;
    origin?: { kind: string };
  }>;
}

function lastReminder(agent: Agent): string {
  const last = history(agent).findLast((message) => message.role === 'user');
  return last?.content?.map((part) => part.text ?? '').join('') ?? '';
}

describe('PremiumQualityInjector', () => {
  it('injects full visual guidance when premium quality is enabled without an objective', async () => {
    const agent = premiumAgent(true);
    const injector = new PremiumQualityInjector(agent);
    await injector.inject();
    const text = lastReminder(agent);
    expect(text).toContain('Premium Quality mode is ON');
    expect(text).toContain('principal designer');
    expect(text).toContain('PREMIUM QUALITY MODE');
    expect(text).toContain('SearchSkill');
    expect(text).toContain('BrowserScreenshot');
    expect(text).toContain('godly.website');
    expect(text).toContain('picsum.photos/seed/');
  });

  it('injects code density for non-visual goal objectives', async () => {
    const agent = premiumAgent(true, { goalObjective: 'Fix the CLI parser and add unit tests' });
    const injector = new PremiumQualityInjector(agent);
    await injector.inject();
    const text = lastReminder(agent);
    expect(text).toContain(PREMIUM_QUALITY_CODE_FULL_GUIDANCE);
    expect(text).toContain('code/evidence density');
    expect(text).not.toContain(PREMIUM_QUALITY_FULL_GUIDANCE.slice(0, 80));
    expect(text).not.toContain('godly.website');
    expect(text.length).toBeLessThan(PREMIUM_QUALITY_FULL_GUIDANCE.length / 2);
  });

  it('injects full visual guidance for visual Ultrawork objectives', async () => {
    const agent = premiumAgent(true, {
      runObjective: 'Redesign the dashboard UI with browser screenshots',
    });
    const injector = new PremiumQualityInjector(agent);
    await injector.inject();
    const text = lastReminder(agent);
    expect(text).toContain(PREMIUM_QUALITY_FULL_GUIDANCE.slice(0, 40));
    expect(text).toContain('BrowserScreenshot');
    expect(text).toContain('godly.website');
  });

  it('injects exit guidance when premium quality turns off', async () => {
    const agent = premiumAgent(true);
    const injector = new PremiumQualityInjector(agent);
    await injector.inject();
    agent.premiumQuality.setEnabled(false);
    await injector.inject();
    expect(lastReminder(agent)).toContain('Premium Quality mode is OFF');
  });

  it('does not re-flood full guidance for injection-origin user messages', async () => {
    const agent = premiumAgent(true);
    const injector = new PremiumQualityInjector(agent);
    await injector.inject();
    const before = history(agent).length;

    history(agent).push({
      role: 'user',
      content: [{ type: 'text', text: '<system-reminder>other injector</system-reminder>' }],
      origin: { kind: 'injection', variant: 'current_time' },
    });
    history(agent).push({ role: 'assistant', content: [{ type: 'text', text: 'working' }] });

    await injector.inject();
    expect(history(agent)).toHaveLength(before + 2);
  });

  it('uses sparse guidance after four assistant turns without a new real user prompt', async () => {
    const agent = premiumAgent(true);
    const injector = new PremiumQualityInjector(agent);
    await injector.inject();
    history(agent).push({ role: 'assistant' }, { role: 'assistant' });
    await injector.inject();
    expect(history(agent).filter((m) => m.origin?.kind === 'injection')).toHaveLength(1);

    history(agent).push({ role: 'assistant' }, { role: 'assistant' });
    await injector.inject();

    const text = lastReminder(agent);
    expect(text).toContain(PREMIUM_QUALITY_SPARSE_GUIDANCE);
    expect(text).not.toContain(PREMIUM_QUALITY_FULL_GUIDANCE.slice(0, 80));
  });

  it('uses code sparse guidance for non-visual objectives after four assistant turns', async () => {
    const agent = premiumAgent(true, { goalObjective: 'Refactor the RPC session API' });
    const injector = new PremiumQualityInjector(agent);
    await injector.inject();
    history(agent).push(
      { role: 'assistant' },
      { role: 'assistant' },
      { role: 'assistant' },
      { role: 'assistant' },
    );
    await injector.inject();
    expect(lastReminder(agent)).toContain(PREMIUM_QUALITY_CODE_SPARSE_GUIDANCE);
    expect(lastReminder(agent)).not.toContain('BrowserScreenshot');
  });

  it('re-injects full guidance after a real user prompt', async () => {
    const agent = premiumAgent(true);
    const injector = new PremiumQualityInjector(agent);
    await injector.inject();
    history(agent).push({
      role: 'user',
      content: [{ type: 'text', text: 'please polish the dashboard' }],
      origin: { kind: 'user' },
    });
    await injector.inject();

    expect(lastReminder(agent)).toContain('Premium Quality mode is ON');
    expect(lastReminder(agent)).toContain('principal designer');
  });
});
