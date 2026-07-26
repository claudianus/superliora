---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/turn/tool-result-budget regression cases

- `buildToolResultPreview` — pin the verbatim-passthrough for inputs at or below the head+tail+20 character threshold, and the head + `...` + tail rendering for longer inputs (preserving the first 160 chars and the last 160 chars).
- `budgetToolResultForModel` — pin the no-archive paths: text fits the default budget, no homedir supplied, result already marked `truncated`, and a non-text content-part array output. Also pin the large-window budget (12_000 chars) that activates when `contextWindowTokens >= 100_000`.
