---
'@superliora/liora': patch
---

Stop residual TUI freezes when geometry probes remeasure live tool cards: line-count measurement no longer runs rebuildBody/requestRender side effects, and ambient subagent block rebuilds share the same per-tick budget as tool body rebuilds.
