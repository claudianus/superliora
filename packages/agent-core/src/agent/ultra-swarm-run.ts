import type { TeamPlan } from '@superliora/protocol';

export interface UltraSwarmRunContext {
  readonly runId: string;
  readonly parentToolCallId: string;
  readonly team: TeamPlan;
  readonly busEnabled: boolean;
  readonly expertAgentIds: Map<string, string>;
}

export function createUltraSwarmRunContext(input: {
  readonly runId: string;
  readonly parentToolCallId: string;
  readonly team: TeamPlan;
  readonly busEnabled: boolean;
}): UltraSwarmRunContext {
  return {
    runId: input.runId,
    parentToolCallId: input.parentToolCallId,
    team: input.team,
    busEnabled: input.busEnabled,
    expertAgentIds: new Map(),
  };
}
