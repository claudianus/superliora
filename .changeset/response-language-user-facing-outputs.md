---
'@superliora/agent-core': minor
'@superliora/liora': minor
---

Apply the locked response language to user-facing LLM output beyond the main conversation loop. Compaction summaries (all four summarizer paths) and next-task suggestions now carry the response-language directive, and subagents, experts, swarm members, and side-question agents inherit the session response language instead of being gated to the main agent only. Code, paths, identifiers, and structured section labels stay in their original language.
