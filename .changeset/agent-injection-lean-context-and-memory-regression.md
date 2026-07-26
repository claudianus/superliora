---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/injection/{lean-context-injector, memory} regression cases

- `LeanContextInjector.getInjection()` gating: no lean tool → undefined; lean
  tool present → guidance block; stable lean tool set always emits.
- `MemoryInjector.getInjection()` branches: non-`main` agent type, missing
  memory, disabled memory, no user prompt, first-time emit with the latest
  user prompt text, same-prompt re-skip.
- `MemoryInjector` lifecycle: `onContextClear`, `onContextMessageRemoved`,
  `onContextCompacted` shift the cached user-message index.
