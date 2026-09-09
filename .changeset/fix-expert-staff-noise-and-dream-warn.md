---
"@superliora/agent-core": patch
---

Fix expert staffing for coding jobs: filter filler tokens from MiniSearch and strip agent reminder boilerplate from the staffing query, and gate implement/task/verify staffing to technical divisions so a meeting-notes or marketing persona can no longer win a coding brief. Quiet the turn-end memory-reflection log when the session memory store is already closed (expected during teardown, previously a warn on every short run).
