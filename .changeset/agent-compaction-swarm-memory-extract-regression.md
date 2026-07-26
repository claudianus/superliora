---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/compaction/swarm-memory-extract.ts regression cases

- Empty `<expert>` attrs degenerate as `<expert ...>` whitespace form (realistic shape) — fall back to `unknown` runId / `unknown` expertId while still producing exactly one run.
- `extractSwarmRunsFromMessages` text-part concatenation is pinned to the newline-separated shape (mirrors how tool result bodies land after a single text part) so the test exercises the same regex the production code path uses.
