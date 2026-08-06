---
"@superliora/liora": patch
---

Append a deterministic [friction] report (turns, tool calls, tool errors by tool) to subagent results when the worker hit errors, so the main agent — and the refine pipeline that reviews its trajectory — can see where workers struggled instead of only receiving the final summary.
