---
'@superliora/liora': patch
---

Stop the TUI from going permanently unresponsive when scrolling: pure scroll paint no longer runs live tool-card rebuild/requestRender ticks that could busy-loop the main thread under wheel storms.
