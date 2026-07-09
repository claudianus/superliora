---
"@superliora/liora": patch
---

Fix prompts failing with "No OAuth manager configured for provider xai-grok" after signing in with an xAI Grok account. Non-Kimi OAuth providers (xAI Grok, OpenAI Codex) now resolve their access token through the correct provider manager instead of the Kimi-only path.
