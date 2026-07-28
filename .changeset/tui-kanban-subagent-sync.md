---
'@superliora/liora': minor
---

Surface live subagent todo progress on the Todo Board. `subagent.todo.updated`
events now feed a compact "subagents" strip below the board lanes — one row per
active subagent with a mini progress bar and done/total counts — for foreground
and background subagents alike, not just swarm-grid members. Rows enter with
the board's settle flash, update live, and leave on `subagent.completed` /
`subagent.failed` (with a header flash); the strip is bounded to six rows and
clears on session reset. With effects off (off profile / SSH / NO_COLOR / CI)
the strip renders fully statically.
