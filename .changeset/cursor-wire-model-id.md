---
"@superliora/liora": patch
---

Fix Cursor OAuth model requests that failed with `ERROR_BAD_MODEL_NAME` when discovery returned `cursor-` prefixed ids. Prefixed catalog names are stripped before AgentService/Run.
