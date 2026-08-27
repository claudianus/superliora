---
"@superliora/liora": minor
---

Add custom model input for unlisted and just-released models and refresh model catalog handling.

- Add Ctrl+N custom model dialog in the model picker and `liora provider model add <providerId> <modelId>` for any wire ID not yet in models.dev or provider /models; custom entries are marked userManaged and survive catalog refreshes. Run /model then Ctrl+N or `liora provider model add anthropic claude-opus-4-8 --thinking` to try it.
- Keep live catalog and OAuth model discovery as the primary source while removing retired hard-coded fallbacks (refresh Copilot, Codex, xAI, and cloud Claude presets and wire defaults).
