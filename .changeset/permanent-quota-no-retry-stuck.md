---
"@superliora/liora": patch
---

Stop treating exhausted account quota and missing payment as retryable rate limits, so the CLI fails immediately instead of spinning until Esc or Ctrl+C cannot cancel.
