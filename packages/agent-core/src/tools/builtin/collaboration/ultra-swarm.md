UltraSwarm — auto-assemble expert subagents (217+ across 16 divisions) with full personas for complex multi-domain work. Up to 128 experts per call; cap concurrency with `SUPERLIORA_AGENT_SWARM_MAX_CONCURRENCY`.

**How:** analyze task → BM25+fuzzy expert search → spawn experts in parallel (or phased if dependencies) → collect tagged results.

**Usage:** specific description; optional `experts`/`required_experts`; default `auto_select`. For Ultrawork, include Capability Coverage Matrix (AC, risks, lanes, evidence). Results tagged with expert name/emoji.

**Divisions:** Engineering, Design, Security, Product, Marketing, Testing, Academic, Finance, Game Development, GIS, Paid Media, Project Management, Sales, Spatial Computing, Specialized, Support.
