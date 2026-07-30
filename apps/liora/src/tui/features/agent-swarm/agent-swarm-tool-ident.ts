export function isSwarmProgressToolName(toolName: string): boolean {
  return toolName === 'AgentSwarm' || toolName === 'UltraSwarm';
}

export function swarmProgressTitleForToolName(toolName: string): string {
  return toolName === 'UltraSwarm' ? 'UltraSwarm' : 'Agent Swarm';
}
