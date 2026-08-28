---
"@superliora/sdk": patch
"@superliora/liora": patch
---

Fix opencode-go muse-spark 1.2 contributor routing to use openai_responses. The zen/go chat completions endpoint returns 500 for this model while the responses endpoint succeeds. Split opencode-go into opencode-go (openai) and opencode-go-muse (openai_responses) so the alias opencode-go/muse-spark-1.2-contributor continues to work without breaking glm/kimi models.
