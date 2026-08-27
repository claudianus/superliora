---
"@superliora/liora": patch
---

Retry and fail over when a provider returns HTTP 5xx such as Anthropic 529 or Cloudflare 524, not only 500–504.
