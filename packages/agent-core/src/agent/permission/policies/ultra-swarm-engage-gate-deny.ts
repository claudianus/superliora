import type { Agent } from '../..';
import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult } from '../types';

export class UltraSwarmEngageGateDenyPermissionPolicy implements PermissionPolicy {
  readonly name = 'ultra-swarm-engage-gate-deny';

  constructor(private readonly agent: Agent) {}

  evaluate(context: PermissionPolicyContext): PermissionPolicyResult | undefined {
    if (this.agent.ultraSwarmEngageGate?.isActive !== true) return;
    const toolName = context.toolCall.name;
    // After an approved Ultra Plan with ENGAGE, the model must first create the
    // verifiable UltraGoal (if it does not already exist), then call UltraSwarm.
    // GetGoal is allowed so the model can confirm the current goal state.
    if (
      toolName === 'UltraSwarm' ||
      toolName === 'EnterPlanMode' ||
      toolName === 'CreateGoal' ||
      toolName === 'GetGoal'
    ) {
      return;
    }

    return {
      kind: 'deny',
      message:
        'UltraSwarm ENGAGE is binding. Create the verifiable UltraGoal with CreateGoal (or check it with GetGoal), then call UltraSwarm as the next execution tool. To revise the Swarm decision to DEFER with a waiver, enter plan mode.',
      reason: {
        required_tool: 'UltraSwarm',
        attempted_tool: toolName,
      },
    };
  }
}
