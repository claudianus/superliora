---
'@superliora/agent-core': patch
'@superliora/liora': patch
---

Emit a GOAL_NO_PROGRESS wire warning when the goal loop stalls for K turns, and show a named TUI notice (stalled terminal) instead of a silent model-only injection.
