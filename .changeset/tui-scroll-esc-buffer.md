---
'@superliora/liora': patch
---

Stop transcript mouse-wheel scrolls from canceling the active agent run. Incomplete Escape sequences are buffered, real Escape still cancels after a short timeout, and wheel events are always consumed.
