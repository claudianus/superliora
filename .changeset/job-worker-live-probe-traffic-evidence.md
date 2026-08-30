---
"@superliora/liora": patch
---

Treat a recent successful LLM call on a model as proof it is live, so job workers no longer get blocked by a false probe failure on a model the session is actively using.
