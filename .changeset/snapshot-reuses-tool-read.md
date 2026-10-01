---
"@superliora/liora": patch
---

Stop Edit, Write, and ApplyPatch from reading the target file twice per mutation — the /rewind before-write snapshot now reuses the read the tool already did.
