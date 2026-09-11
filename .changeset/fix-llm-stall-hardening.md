---
"@superliora/liora": patch
---

Fix wedged agent sessions: add LLM stream first-token and whole-stream timeouts, stop retrying billing-exhausted (401/402/403) provider errors, refuse subagent deadline extensions without new tool progress, and stop the recurring side-call (ghost/suggest) retries against a broken completion model.
