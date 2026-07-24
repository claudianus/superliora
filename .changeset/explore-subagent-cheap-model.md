---
'@superliora/liora': minor
---

Route read-only exploration subagents to a cheap model automatically. When a subagent runs an explore-type profile and a cheap alias can be inferred from the configured models (haiku/flash/nano/mini/lite/turbo), it now uses that cheap model instead of the parent's model; coder/plan/other profiles and any case with no inferable cheap model keep the parent model unchanged.
