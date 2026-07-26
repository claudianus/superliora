---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/permission/policies/{auto-mode-approve, fallback-ask} regression cases

- `AutoModeApprovePermissionPolicy` — pin the `approve` decision when the agent permission mode is `auto`, the `undefined` decision for any other mode (`approve-asks` / `yolo` / `plan`), and the documented policy name (`auto-mode-approve`).
- `FallbackAskPermissionPolicy` — pin the unconditional `ask` decision regardless of the supplied context (including `undefined`), and the documented policy name (`fallback-ask`).
