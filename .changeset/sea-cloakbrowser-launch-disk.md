---
"@superliora/liora": patch
---

Fix CloakBrowser launch under SEA/native builds so VerifySurface can spawn the browser without a missing `launch` binding from the inlined `init_dist` export shim.
