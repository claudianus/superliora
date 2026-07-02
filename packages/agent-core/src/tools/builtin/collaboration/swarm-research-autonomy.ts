const SWARM_RESEARCH_AUTONOMY = [
  '<swarm_research_autonomy>',
  'Unless the parent prompt or user forbids internet use, use WebSearch and FetchURL as often as needed to verify current papers, best practices, library choices, APIs, security notes, package health, and maintained open-source implementations relevant to your assigned scope.',
  'Fetch primary sources before relying on snippets. Include source URLs for findings that affect implementation, recommendations, or verification.',
  '</swarm_research_autonomy>',
].join('\n');

export function appendSwarmResearchAutonomy(prompt: string): string {
  if (prompt.includes('<swarm_research_autonomy>')) return prompt;
  return `${prompt.trimEnd()}\n\n${SWARM_RESEARCH_AUTONOMY}`;
}
