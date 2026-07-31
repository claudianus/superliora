export function isSwarmProgressToolName(toolName: string): boolean {
  return toolName === 'Fleet' || toolName === 'AgentSwarm' || toolName === 'UltraSwarm';
}

export function swarmProgressTitleForToolName(toolName: string): string {
  if (toolName === 'UltraSwarm') return 'UltraSwarm';
  if (toolName === 'Fleet') return 'Fleet';
  return 'Agent Swarm';
}
