import type { Agent } from '../..';
import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult } from '../types';

export class UltraSwarmEngageGateDenyPermissionPolicy implements PermissionPolicy {
  readonly name = 'ultra-swarm-engage-gate-deny';

  constructor(private readonly agent: Agent) {}

  evaluate(context: PermissionPolicyContext): PermissionPolicyResult | undefined {
    if (this.agent.ultraSwarmEngageGate?.isActive !== true) return;
    const toolName = context.toolCall.name;
    if (toolName === 'UltraSwarm' || toolName === 'EnterPlanMode') return;

    return {
      kind: 'deny',
      message:
        'UltraSwarm ENGAGE is binding. Call UltraSwarm as the only next execution tool, or enter plan mode to revise the Swarm decision to DEFER with a waiver.',
      reason: {
        required_tool: 'UltraSwarm',
        attempted_tool: toolName,
      },
    };
  }
}
