---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/injection/tool-workflow-injector regression cases

- `getInjection()` no-capability → undefined.
- `getInjection()` exposed capability → dense guidance.
- `onContextClear()` resets the cached capability key.
- Sparse guidance fallback once an assistant turn has accumulated after
  injection.
