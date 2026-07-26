---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/permission/policies/{pre-tool-call-hook, session-approval-history} regression cases

- `PreToolCallHookPermissionPolicy` name + evaluate branches (no hooks / hooks returning undefined / hooks denying).
- `SessionApprovalHistoryPermissionPolicy` name + empty rule list returns undefined.
