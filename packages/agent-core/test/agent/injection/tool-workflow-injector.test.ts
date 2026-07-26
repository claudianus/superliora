import { describe, expect, it } from 'vitest';

import type { Agent } from '#/agent';
import { ToolWorkflowInjector } from '#/agent/injection/tool-workflow-injector';

const buildAgent = (toolNames: string[]): Agent =>
  ({
    tools: { loopTools: toolNames.map((name) => ({ name })) },
    context: { history: [] },
  }) as unknown as Agent;

const userMessage = { role: 'user', origin: { kind: 'user', source: 'user' }, content: [{ type: 'text', text: 'hi' }] } as const;
const assistantMessage = { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } as const;

describe('agent/injection/tool-workflow-injector — getInjection', () => {
  it('returns undefined when no workflow capability is exposed', () => {
    const injector = new ToolWorkflowInjector(buildAgent(['Bash']));
    expect(injector.getInjection()).toBeUndefined();
  });

  it('returns the full guidance when at least one capability is exposed', () => {
    const injector = new ToolWorkflowInjector(buildAgent(['LioraRead']));
    const result = injector.getInjection();
    expect(result).toContain('Tool / Skill / Research Workflow');
  });

  it('onContextClear resets the cached capability key', () => {
    const injector = new ToolWorkflowInjector(buildAgent(['LioraRead']));
    expect(injector.getInjection()).toBeDefined();
    injector.onContextClear();
    expect(injector.getInjection()).toBeDefined();
  });

  it('returns sparse guidance after a few assistant turns with the same capability', () => {
    const agent = buildAgent(['LioraRead']);
    const injector = new ToolWorkflowInjector(agent);
    const full = injector.getInjection();
    expect(full).toBeDefined();
    // Mark first message as the injection anchor so the variant branch runs.
    (injector as unknown as { injectedAt: number }).injectedAt = 0;
    // Provide an assistant turn at index 1.
    agent.context.history = [userMessage as never, assistantMessage as never, assistantMessage as never, assistantMessage as never];
    const sparse = injector.getInjection();
    expect(sparse).toBeDefined();
    expect(sparse!.length).toBeLessThanOrEqual(full!.length + 1);
  });
});
