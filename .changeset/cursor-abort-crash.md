---
"@superliora/liora": patch
---

Fix a Cursor OAuth crash where aborting a request emitted an unhandled stream error and killed the CLI process.
