---
"@superliora/liora": patch
---

Fix Windows jobs failing project checks when SuperLiora home is redirected, so bundled node/pnpm are on the worker PATH. Stop retrying stalled LLM streams so a hung model call fails once instead of burning three idle waits.
