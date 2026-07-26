---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/skill/manager.activate regression cases

- `SKILL_NOT_FOUND` thrown when the registry returns undefined.
- `SKILL_TYPE_UNSUPPORTED` thrown for non-`inline`/`flow`/undefined skill
  types.
- Type-gate pass for an `inline` skill reaches the deeper side-effect path
  (full assertion is gated on richer mocks).
