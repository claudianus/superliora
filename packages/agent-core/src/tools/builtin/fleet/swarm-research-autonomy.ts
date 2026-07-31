const SWARM_RESEARCH_AUTONOMY = [
  '<swarm_research_autonomy>',
  'Unless forbidden, use Context7Resolve and Context7Docs for library/API documentation; use WebSearch and FetchURL for papers, CVEs, blogs, and other primary sources. Fetch and cite URLs that affect recommendations.',
  '</swarm_research_autonomy>',
].join('\n');

export function appendSwarmResearchAutonomy(prompt: string): string {
  if (prompt.includes('<swarm_research_autonomy>')) return prompt;
  return `${prompt.trimEnd()}\n\n${SWARM_RESEARCH_AUTONOMY}`;
}
