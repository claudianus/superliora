import type { Agent } from '..';
import { buildLeanContextGuidance } from './lean-context';
import { DynamicInjector } from './injector';

export class LeanContextInjector extends DynamicInjector {
  protected override readonly injectionVariant = 'lean_context';

  constructor(agent: Agent) {
    super(agent);
  }

  protected override getInjection(): string | undefined {
    if (!this.agent.tools.loopTools.some((tool) => tool.name === 'LioraContext')) return undefined;
    return buildLeanContextGuidance();
  }
}
