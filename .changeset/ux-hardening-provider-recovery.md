---
'@superliora/liora': patch
---

Fix provider reliability: show the real retry wait with a countdown instead of a frozen "Retrying…" status, honor the provider's Retry-After header, and stop endless token refresh loops by routing revoked Google/Kiro/GLM ZCode credentials to re-login.
