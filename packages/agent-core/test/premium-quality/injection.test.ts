import { describe, expect, it } from 'vitest';

import type { Agent } from '../../src/agent';
import { PremiumQualityInjector } from '../../src/agent/injection/premium-quality';
import { PREMIUM_QUALITY_FULL_GUIDANCE, PREMIUM_QUALITY_SPARSE_GUIDANCE } from '../../src/premium-quality/guidance';

function premiumAgent(enabled: boolean): Agent {
  const history: unknown[] = [];
  let isEnabled = enabled;
  return {
    premiumQuality: {
      isEnabled: () => isEnabled,
      setEnabled: (next: boolean) => {
        isEnabled = next;
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
  it('injects full guidance when premium quality is enabled', async () => {
    const agent = premiumAgent(true);
    const injector = new PremiumQualityInjector(agent);
    await injector.inject();
    const text = lastReminder(agent);
    expect(text).toContain('Premium Quality mode is ON');
    expect(text).toContain('bulldozer');
    expect(text).toContain('KING-GOD-GENERAL');
    expect(text).toContain('SearchSkill');
    expect(text).toContain('BrowserScreenshot');
    expect(text).toContain('https://godly.website/');
    expect(text).toContain('picsum.photos/seed/');
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

  it('uses sparse guidance after assistant turns without a new real user prompt', async () => {
    const agent = premiumAgent(true);
    const injector = new PremiumQualityInjector(agent);
    await injector.inject();
    history(agent).push({ role: 'assistant' }, { role: 'assistant' });
    await injector.inject();

    const text = lastReminder(agent);
    expect(text).toContain(PREMIUM_QUALITY_SPARSE_GUIDANCE);
    expect(text).not.toContain(PREMIUM_QUALITY_FULL_GUIDANCE.slice(0, 80));
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
    expect(lastReminder(agent)).toContain('KING-GOD-GENERAL');
  });
});
