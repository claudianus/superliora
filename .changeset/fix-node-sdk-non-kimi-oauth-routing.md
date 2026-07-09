---
"@superliora/liora": patch
---

Fix prompts failing with "No OAuth manager configured for provider xai-grok" when the TUI resolves auth through the node-sdk auth facade. Non-Kimi OAuth providers (xAI Grok, OpenAI Codex) now route token resolution and logout through the shared provider manager on this path as well, matching the agent-core fix landed earlier.
