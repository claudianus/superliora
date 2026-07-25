---
'@superliora/liora': patch
---

Compaction picks the cheapest local models.*.cost alias (then name heuristics), sends summaries with no tool schemas, and retries xAI-style at-capacity / high-demand errors. Every compaction LLM path (summary, parallel blocks, merge, repair) streams text into compaction.progress with streamKind metadata so the TUI shows live preview, block N/M status, and char counts. No dedicated Subagent spawn.
