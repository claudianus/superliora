const SWARM_RESEARCH_AUTONOMY = [
  '<swarm_research_autonomy>',
  'Unless forbidden, use WebSearch and FetchURL as often as needed for current papers, APIs, security, libraries, and OSS relevant to your scope. Fetch primary sources; cite URLs that affect recommendations.',
  '</swarm_research_autonomy>',
].join('\n');

export function appendSwarmResearchAutonomy(prompt: string): string {
  if (prompt.includes('<swarm_research_autonomy>')) return prompt;
  return `${prompt.trimEnd()}\n\n${SWARM_RESEARCH_AUTONOMY}`;
}
