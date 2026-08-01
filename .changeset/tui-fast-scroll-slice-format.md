---
'@superliora/liora': patch
---

Stop fast transcript scroll freezes by formatting only the visible slice of tall messages and keeping overflow paint caches across ambient ticks so wheel storms no longer re-paint every historical line.
