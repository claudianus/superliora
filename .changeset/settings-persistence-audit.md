---
"@superliora/liora": patch
---

Persist TUI settings changes reliably: theme, model, permission mode, thinking, and editor selections now write through to config, and config PATCH accepts mcp/extras/agent/media sections so no setting is silently dropped on save or reload.
