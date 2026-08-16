---
'@superliora/liora': patch
---

Hard-rewrite the first present after construct/resize so clearOnStart does not leave a blank ConPTY chrome frame, and keep composition topology structural-only to stop ambient clear/VFX thrash.
