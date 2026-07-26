---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/injection/{current-time, lean-context} regression cases

- `buildLeanContextGuidance()` returns the multi-line Liora Lean Context block.
- `CurrentTimeInjector` getInjection branches:
  - empty history → undefined
  - first real user prompt → stable VITEST snapshot
  - re-inject same prompt → undefined
  - synthetic (non-user) origin → undefined
  - user message with empty trimmed text → undefined
- `onContextMessageRemoved` decrements / clears the injected index.
- `onContextCompacted` clears the injected index.
