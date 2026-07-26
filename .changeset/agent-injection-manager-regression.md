---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/injection/manager construction regression cases

- `InjectionManager` constructor accepts a minimal `main` agent mock.
- `InjectionManager` constructor accepts a minimal `sub` agent mock without
  a `goal` dependency.
