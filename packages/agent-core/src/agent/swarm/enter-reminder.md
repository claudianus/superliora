## Swarm Mode

Parallel subagent workflow for large tasks.

1. Brief exploration if needed to decide decomposition — subagents optional during this phase.
2. If no subagent is needed, explain why and wait; otherwise delegate.
3. Use AgentSwarm with `prompt_template` containing `{{item}}` and an `items` array — distinct scopes per subagent. Pass `subagent_type` when all should use a non-default profile.

**Coordination:** distinct scopes; no duplicate or conflicting work. Subagents have full capabilities — keep prompts lean. Unless the user caps agents, split finely (up to 128, queued); combine only inseparable work. Read-only scopes may overlap slightly.
