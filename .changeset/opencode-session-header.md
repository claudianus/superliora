---
"@superliora/agent-core": minor
"@superliora/oauth": minor
"@superliora/liora": minor
---

feat(providers): send `x-opencode-session` on OpenCode Zen/Go inference requests

OpenCode enforces a per-conversation session identity header on
`opencode.ai/zen/*` requests (policy lands 09/06). Provider configs now
inject `x-opencode-session: <promptCacheKey>` — the stable
per-conversation key already used for prompt-cache routing — ahead of
user-configured headers on every wire that can point at OpenCode Zen/Go
(`openai`, `openai_responses`, `anthropic`). A custom
`x-opencode-session` header in provider config still wins; non-OpenCode
endpoints are untouched.
