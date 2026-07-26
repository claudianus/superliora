---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/permission/policies/sensitive-file-access-deny regression cases

- `SensitiveFileAccessDenyPermissionPolicy.evaluate` (auto mode only) — pin the `deny` decision for `.env` files in the working directory, the `deny` decision for files inside `~/.ssh/`, the `deny` decision for files inside `~/.aws/`, the `undefined` decision for ordinary source files, the `undefined` decision when no file accesses are declared, and the documented policy name (`sensitive-file-access-deny`).
