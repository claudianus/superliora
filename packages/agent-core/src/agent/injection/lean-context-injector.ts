import type { Agent } from '..';
import { isRealUserPromptOrigin } from '../context/types';
import { buildLeanContextGuidance } from './lean-context';
import { DynamicInjector } from './injector';

/**
 * Lean-context routing is stable for a profile. Inject once on first need,
 * after a real user prompt, or after a longer assistant stretch so compaction
 * / multi-step loops do not append the same lean-context block every few steps.
 */
const LEAN_CONTEXT_REFRESH_ASSISTANT_TURNS = 10;

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
    if (this.injectedAt !== null && !this.shouldRefresh()) {
      return undefined;
    }
    return buildLeanContextGuidance();
  }

  private shouldRefresh(): boolean {
    if (this.injectedAt === null) return true;
    const history = this.agent.context.history;
    let assistantTurnsSince = 0;
    for (let i = this.injectedAt + 1; i < history.length; i++) {
      const msg = history[i];
      if (msg === undefined) continue;
      if (msg.role === 'assistant') {
        assistantTurnsSince += 1;
        continue;
      }
      if (msg.role === 'user' && isRealUserPromptOrigin(msg.origin)) {
        return true;
      }
    }
    return assistantTurnsSince >= LEAN_CONTEXT_REFRESH_ASSISTANT_TURNS;
  }
}
