import type { TeamPlan } from '@superliora/protocol';

import type { Agent } from '../../../agent';
import {
  injectUltraworkPostSwarmContinuation,
  maybeAdvanceUltraworkStage,
} from '../../../ultrawork';

export function emitUltraSwarmTeamStaffedEvent(
  agent: Agent,
  runId: string,
  toolCallId: string,
  team: TeamPlan,
): void {
  agent.ultrawork.attachTeamPlan(team);
  maybeAdvanceUltraworkStage(agent, 'staff', 'UltraSwarm staffed');
  maybeAdvanceUltraworkStage(agent, 'swarm', 'UltraSwarm engaged');
  agent.emitEvent({
    type: 'ultrawork.team.staffed',
    runId,
    toolCallId,
    team,
  });
}

export function onUltraSwarmRunCompleted(agent: Agent): void {
  agent.ultraSwarmEngageGate?.clear('ultra-swarm-completed');
  maybeAdvanceUltraworkStage(agent, 'integrate', 'UltraSwarm completed');
  injectUltraworkPostSwarmContinuation(agent);
}
