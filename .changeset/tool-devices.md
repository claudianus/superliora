---
"@superliora/liora": minor
---

Add opt-in tool devices: with `SUPERLIORA_EXPERIMENTAL_TOOL_DEVICES=true`, rarely used tool schemas stay out of every request's tool block (up to ~99 KB on the full profile) and are still callable through the new `ToolDevice` tool, which lists them and runs one with that tool's own parameter validation and approval rules. Off by default.