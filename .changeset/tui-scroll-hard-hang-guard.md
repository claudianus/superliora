---
'@superliora/liora': patch
---

Stop the TUI from going permanently unresponsive when scrolling: pure scroll paint no longer runs live tool-card rebuilds, and running shell/swarm cards no longer schedule another frame from inside render (busy-loop under wheel storms).
