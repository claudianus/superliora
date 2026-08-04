---
"@superliora/liora": patch
---

Fix Cursor provider turns that leaked raw tool markup or died mid-run: answer request-context/interaction/KV frames, close shell streams, keep idle alive on progress frames, and recover text-form tool calls.
