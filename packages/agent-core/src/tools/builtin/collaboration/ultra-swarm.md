UltraSwarm — auto-assemble expert subagents (400+ / 16 divisions) for complex multi-domain work. Cap concurrency with `SUPERLIORA_AGENT_SWARM_MAX_CONCURRENCY`.

**How:** analyze → BM25 + fuzzy expert search → spawn parallel/phased experts → collect tagged results. Prefer a sharp description; optional `experts`/`required_experts`; default `auto_select`. For Ultrawork, include a Capability Coverage Matrix (AC/risks/lanes/evidence).

**TodoList sync:** WorkGraph nodes mirror as `[nodeId] title` (UltraworkGraph `sync_todos`). Each expert should create a TodoList within the first 2 tool calls.

**Divisions (glance):** Engineering, Design, Security, Product, Marketing, Testing, Academic, Finance, Game Dev, GIS, Paid Media, Project Management, Sales, Spatial Computing, Specialized, Support.
