---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/permission/policies.createPermissionDecisionPolicies regression cases

- `createPermissionDecisionPolicies` — pin the documented ordering of the 22 permission policy classes (deny-style rules first, then the auto-mode approval, then user-configured ask / allow, then plan-mode / goal-start / sensitive-file / git / yolo ask/approve rules, and the `FallbackAskPermissionPolicy` last in the chain).
- Pin the no-shared-state guarantee (a fresh list on every call).
- Pin the ordering invariants: hard-deny rules placed before the auto-mode approval rule, and the user-configured ask rule placed ahead of the user-configured allow rule.
