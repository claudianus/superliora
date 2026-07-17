---
"@superliora/agent-core": patch
---

**WebSearch execution defaults**

- When the model omits `limit` / `include_content`, pass concrete `limit: 3` and `includeContent: false` into the host provider so denser provider fallbacks cannot reappear.
