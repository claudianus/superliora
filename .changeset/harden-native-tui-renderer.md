---
"@moonshot-ai/kimi-code": patch
---

Fix TUI screen corruption, ghost lines, and duplicate output by disabling terminal autowrap during rendering and clearing stale rows when the terminal shrinks.
