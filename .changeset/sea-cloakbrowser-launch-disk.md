---
"@superliora/liora": patch
---

Fix CloakBrowser launch under SEA/native builds so VerifySurface can spawn the browser: keep cloakbrowser on disk next to the CLI, and do not use the inlined `init_dist` export shim.
