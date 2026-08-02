---
'@superliora/agent-core': patch
---

CacheFreezeGuard soft-checks the tool-list fingerprint every step (`checkUnchanged`) and logs mid-turn drift. Hard freeze still blocks setActiveTools; ephemeral orchestrator tools stay attachable.
