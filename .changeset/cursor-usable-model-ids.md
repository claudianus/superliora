---
"@superliora/liora": patch
---

Fix Cursor OAuth model ids that still failed after the `cursor-` prefix strip. Prefer GetUsableModels wire ids and rewrite AvailableModels `effort-fast` slugs to the `fast-effort` form Run accepts (for example `grok-4.5-high-fast` → `grok-4.5-fast-high`).
