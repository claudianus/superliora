---
'@superliora/liora': patch
---

Finish remaining scroll-path hardening: cache ANSI→cell promote for unchanged viewport windows, skip live thinking/assistant re-encode during pure scroll paint, and hold footer/header timer refreshes briefly after wheel activity so chrome does not fight interactive frames.
