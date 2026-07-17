---
"@superliora/agent-core": patch
"@superliora/liora": patch
---

**Research-aligned async flag copy + office SearchSkill defaults**

- `async_compaction` flag description matches async **0.70** / soft **0.80** / hard **0.92** (no densify 1% wording).
- SearchSkill query schema includes Word/PowerPoint/Excel keywords; omitted `top_k` defaults to **5**.
