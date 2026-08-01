---
'@superliora/liora': patch
---

Make long sessions cheaper on idle frames, expanded code highlights, and live tool stdout by tracking the idle stage in O(1), keeping path-hinted highlight cache entries sticky, and patching streaming tool output in place instead of rebuilding the tool card every chunk.
