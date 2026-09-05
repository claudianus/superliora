---
"@superliora/liora": minor
---

Add Command Code as a built-in gateway provider: one API key serves 30+ models (Claude, GPT, Gemini, and top open models), with Claude routed over Anthropic Messages and everything else over Chat Completions. Connect it from `/login` or with `liora provider catalog add commandcode --api-key "$CMD_API_KEY"`.
