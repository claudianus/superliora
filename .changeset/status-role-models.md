---
'@superliora/liora': minor
---

Show role-based model assignments in the `/status` report. The status panel now renders a "Role models" section listing the configured `compactionModel`, `completionModel`, and `explorationModel` (showing "auto" when a role is unset and auto-inferred), threaded from the agent loop-control config through the session status response and SDK. Also adds the missing `getUsage` mock to the session-service test bridge.
