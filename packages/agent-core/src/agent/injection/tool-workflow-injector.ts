import type { Agent } from '..';
import { isRealUserPromptOrigin } from '../context/types';
import { DynamicInjector } from './injector';
import {
  buildToolWorkflowGuidance,
  buildToolWorkflowSparseGuidance,
  hasToolWorkflowSurface,
  resolveToolWorkflowCapability,
  type ToolWorkflowCapability,
} from './tool-workflow';

/**
 * Full contract on first need or capability change; sparse checkpoints on a
 * real user prompt and every few assistant turns so long loops do not forget
 * SearchSkill / WebSearch. The system prompt already carries the full
 * contract, so later re-injections stay sparse.
 */
const TOOL_WORKFLOW_SPARSE_REFRESH_TURNS = 3;

export class ToolWorkflowInjector extends DynamicInjector {
  protected override readonly injectionVariant = 'tool_workflow';
  private lastCapKey: string | null = null;

  constructor(agent: Agent) {
    super(agent);
  }

  override onContextClear(): void {
    super.onContextClear();
    this.lastCapKey = null;
  }

  protected override getInjection(): string | undefined {
    const names = this.agent.tools.loopTools.map((tool) => tool.name);
    const cap = resolveToolWorkflowCapability(names);
    if (!hasToolWorkflowSurface(cap)) return undefined;

    const capKey = capabilityKey(cap);
    if (this.injectedAt === null || this.lastCapKey !== capKey) {
      this.lastCapKey = capKey;
      return buildToolWorkflowGuidance(cap);
    }

    if (!this.shouldEmitSparseCheckpoint()) return undefined;
    this.lastCapKey = capKey;
    return buildToolWorkflowSparseGuidance(cap);
  }

  private shouldEmitSparseCheckpoint(): boolean {
    const anchor = this.injectedAt;
    if (anchor === null) return true;
    const history = this.agent.context.history;
    let assistantTurnsSince = 0;
    for (let i = anchor + 1; i < history.length; i++) {
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
    return assistantTurnsSince >= TOOL_WORKFLOW_SPARSE_REFRESH_TURNS;
  }
}

function capabilityKey(cap: ToolWorkflowCapability): string {
  return (
    Object.entries(cap) as Array<[keyof ToolWorkflowCapability, boolean]>
  )
    .filter(([, v]) => v)
    .map(([k]) => k)
    .sort()
    .join('|');
}
