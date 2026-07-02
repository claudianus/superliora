import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult } from '../types';

export class AgentSwarmExclusiveDenyPermissionPolicy implements PermissionPolicy {
  readonly name = 'agent-swarm-exclusive-deny';

  evaluate(context: PermissionPolicyContext): PermissionPolicyResult | undefined {
    const toolCalls = context.toolCalls;
    const swarmToolCalls = toolCalls.filter((toolCall) => isSwarmToolName(toolCall.name));
    const agentSwarmCount = swarmToolCalls.length;

    if (agentSwarmCount === 0) return;
    if (agentSwarmCount === 1 && toolCalls.length === 1) return;

    const label = swarmToolLabel(swarmToolCalls.map((toolCall) => toolCall.name));
    return {
      kind: 'deny',
      message:
        agentSwarmCount > 1
          ? multipleAgentSwarmDeniedMessage(toolCalls.length > agentSwarmCount, label)
          : mixedAgentSwarmDeniedMessage(label),
      reason: {
        agent_swarm_tool_calls: agentSwarmCount,
        tool_calls: toolCalls.length,
      },
    };
  }
}

function isSwarmToolName(toolName: string): boolean {
  return toolName === 'AgentSwarm' || toolName === 'UltraSwarm';
}

function swarmToolLabel(toolNames: readonly string[]): string {
  const unique = new Set(toolNames);
  if (unique.size === 1) return toolNames[0] ?? 'Swarm tool';
  return 'Swarm tools';
}

function multipleAgentSwarmDeniedMessage(hasOtherToolCalls: boolean, label: string): string {
  const suffix = hasOtherToolCalls
    ? ` ${label} also must not be combined with other tools in the same response.`
    : '';
  if (label !== 'AgentSwarm') {
    return (
      `${label} must be called one swarm at a time. Multiple swarm calls are not forbidden, ` +
      `but issue them sequentially: call one swarm tool, wait for its result, then call the next; ` +
      `or merge the work into a single swarm when one swarm can cover it.${suffix}`
    );
  }
  return (
    'AgentSwarm must be called one swarm at a time. Multiple AgentSwarm calls are not forbidden, ' +
    'but issue them sequentially: call one AgentSwarm, wait for its result, then call the next; ' +
    `or merge the work into a single AgentSwarm when one swarm can cover it.${suffix}`
  );
}

function mixedAgentSwarmDeniedMessage(label: string): string {
  if (label !== 'AgentSwarm') {
    return (
      `${label} must be the only tool call in a model response. Retry with a single swarm ` +
      'call by itself, then call any other tools after it returns.'
    );
  }
  return (
    'AgentSwarm must be the only tool call in a model response. Retry with a single AgentSwarm ' +
    'call by itself, then call any other tools after it returns.'
  );
}
