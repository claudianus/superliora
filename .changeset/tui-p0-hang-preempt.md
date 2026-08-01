---
'@superliora/liora': patch
---

Hardening against TUI hard freezes: structure changes no longer wipe every message render cache, ambient tool-card body rebuilds are capped per tick, and running shell cards cache pretty-printed tails so ambient frames only refresh the elapsed timer.
