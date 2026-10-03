import type { Agent } from '../../agent';
import type { ThinkingEffort } from '../../agent/config/thinking';

export interface SubagentModelSelection {
  readonly alias: string | undefined;
  readonly thinkingLevel: ThinkingEffort;
}


/** Workers inherit the parent's model unless a caller explicitly selects one. */
export function resolveSubagentModelSelection(
  parent: Agent,
  modelAlias?: string,
): SubagentModelSelection {
  return {
    alias: modelAlias ?? parent.config.modelAlias,
    thinkingLevel: parent.config.thinkingLevel,
  };
}
