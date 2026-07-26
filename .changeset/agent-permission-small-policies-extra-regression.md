---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/permission/policies/{yolo-mode-approve, swarm-mode-agent-swarm-approve, auto-mode-ask-user-question-deny, git-cwd-write-approve} regression cases

- Pin documented policy name + safe construction.
- `AutoModeAskUserQuestionDenyPermissionPolicy.evaluate()` is a historical no-op → pin undefined return.
