---
'@superliora/liora': minor
---

Show what each swarm child is doing in the swarm progress panel. While an AgentSwarm/UltraSwarm runs, the panel now renders one dimmed line per active child with its latest streamed text (or the tool it is currently running), capped at six lines, so swarm activity is visible instead of only an aggregate progress bar. The per-child lines clear as each child settles.
