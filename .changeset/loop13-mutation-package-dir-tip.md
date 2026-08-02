---
'@superliora/agent-core': patch
'@superliora/liora': patch
---

PostToolUse mutation sensor tracks packageDir from Edit/Write/ApplyPatch paths and scopes the verify nudge to package-scoped RunProjectChecks when all mutations share one packages/apps scope.
