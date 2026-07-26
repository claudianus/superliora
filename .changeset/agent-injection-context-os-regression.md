---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/injection/context-os regression cases

- `ContextOSInjector.getInjection()` branches: non-`main` agent type, empty
  history, all-injection trailing block emit, re-emit skipped when signature
  unchanged, `onContextClear` reset.
