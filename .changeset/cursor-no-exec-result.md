---
"@superliora/liora": patch
---

Fix Cursor `No exec result` after tool calls by RST-canceling the Run instead of half-closing the request while mcpArgs is still unanswered.
