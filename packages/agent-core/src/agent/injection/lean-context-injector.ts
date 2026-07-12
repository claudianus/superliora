import type { Agent } from '..';
import { buildLeanContextGuidance } from './lean-context';
import { DynamicInjector } from './injector';

export class LeanContextInjector extends DynamicInjector {
  protected override readonly injectionVariant = 'lean_context';

  constructor(agent: Agent) {
    super(agent);
  }

  protected override getInjection(): string | undefined {
    const leanContextToolNames = new Set([
      'LioraRead',
      'LioraSymbol',
      'LioraCallgraph',
      'LioraExpand',
      'LioraTree',
    ]);
    if (!this.agent.tools.loopTools.some((tool) => leanContextToolNames.has(tool.name))) {
      return undefined;
    }
    return buildLeanContextGuidance();
  }
}
