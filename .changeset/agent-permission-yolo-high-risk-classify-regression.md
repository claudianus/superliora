---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/permission/policies/yolo-high-risk-ask regression cases

- Pin documented policy name (`yolo-high-risk-ask`).
- `classifyYoloHighRiskBash(command)` destructive + credential-like path coverage
  for the pure helper that drives YOLO high-risk ask decisions.
