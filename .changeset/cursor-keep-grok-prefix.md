---
"@superliora/liora": patch
---

Fix Cursor Grok model requests that failed with `ERROR_BAD_MODEL_NAME`. Send GetUsableModels ids verbatim, including the required `cursor-` prefix (for example `cursor-grok-4.5-high-fast`).
