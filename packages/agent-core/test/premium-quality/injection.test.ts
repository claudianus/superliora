import { describe, expect, it, vi } from 'vitest';

import type { Agent } from '../../src/agent';
import { PremiumQualityInjector } from '../../src/agent/injection/premium-quality';

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
        history.push({ role: 'user', content: [{ type: 'text', text: content }] });
      },
    },
  } as unknown as Agent;
}

describe('PremiumQualityInjector', () => {
  it('injects full guidance when premium quality is enabled', async () => {
    const agent = premiumAgent(true);
    const injector = new PremiumQualityInjector(agent);
    await injector.inject();
    const last = agent.context.history.at(-1) as { content: Array<{ text: string }> };
    expect(last.content[0]?.text).toContain('Premium Quality mode is ON');
    expect(last.content[0]?.text).toContain('bulldozer');
    expect(last.content[0]?.text).toContain('KING-GOD-GENERAL');
    expect(last.content[0]?.text).toContain('SearchSkill');
    expect(last.content[0]?.text).toContain('BrowserScreenshot');
    expect(last.content[0]?.text).toContain('https://godly.website/');
    expect(last.content[0]?.text).toContain('picsum.photos/seed/');
  });

  it('injects exit guidance when premium quality turns off', async () => {
    const agent = premiumAgent(true);
    const injector = new PremiumQualityInjector(agent);
    await injector.inject();
    agent.premiumQuality.setEnabled(false);
    await injector.inject();
    const last = agent.context.history.at(-1) as { content: Array<{ text: string }> };
    expect(last.content[0]?.text).toContain('Premium Quality mode is OFF');
  });
});
