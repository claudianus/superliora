---
'@superliora/liora': patch
---

Fix silent hangs and lag: editor (ACP) and server requests now time out instead of pending forever, headless runs skip the update check, unknown CLI commands suggest the closest match, streaming code blocks highlight without re-processing the whole block, and the prompt history no longer grows without bound.
