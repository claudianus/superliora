---
"@superliora/liora": patch
---

Stop provider fallback hops from cooling down every alternate model when a shared timeout abort kills the route, so healthy fallbacks stay usable after a hung primary.
