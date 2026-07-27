---
'@superliora/liora': minor
---

Subagent tool feeds now carry structured detail for common tools — Edit line diffs (`+N -M`), Write line counts, and compact Read/Bash/Grep/Glob targets — rendered with the same chip formatters as the main agent's tool stream. UltraSwarm lanes show live per-member tool activity (including failures) in the ops feed, driven by a new optional `detail` field on `subagent.tool_call` session events. Existing payloads without `detail` stay valid.
