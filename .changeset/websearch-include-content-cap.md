---
"@superliora/agent-core": patch
---

**WebSearch include_content budget**

- Cap per-page text at **8_000** chars when `include_content` is enabled so full HTML dumps cannot thrash context.
