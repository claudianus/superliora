---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/permission/policies/deny-all regression cases

- `DenyAllPermissionPolicy.evaluate` — pin the unconditional `{ kind: 'deny' }` decision for every tool call (Bash / Read / Write), the `undefined`-context crash-safety, and the documented policy name (`deny-all`).
