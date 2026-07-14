UltraSwarm — auto-assemble expert subagents (400+ across 16 divisions) with personas for complex multi-domain work. Cap concurrency with `SUPERLIORA_AGENT_SWARM_MAX_CONCURRENCY`.

**How:** analyze task → BM25+fuzzy expert search → spawn experts in parallel (or phased if dependencies) → collect tagged results.

**Usage:** specific description; optional `experts`/`required_experts`; default `auto_select`. For Ultrawork, include Capability Coverage Matrix (AC, risks, lanes, evidence). Results tagged with expert name/emoji.

**TodoList sync:** WorkGraph nodes mirror to the parent TodoList as `[nodeId] title` (via UltraworkGraph `sync_todos`). Each expert subagent maintains its own live TodoList for scope progress — create within the first 2 tool calls.

**Divisions:** Engineering, Design, Security, Product, Marketing, Testing, Academic, Finance, Game Development, GIS, Paid Media, Project Management, Sales, Spatial Computing, Specialized, Support.
