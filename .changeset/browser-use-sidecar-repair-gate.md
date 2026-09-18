---
"@superliora/liora": patch
---

Fix browser-use install and update skipping sidecar repair when a stray package.json exists above the binary, which left launches failing with "no cloakbrowser package found on disk".
