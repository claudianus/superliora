---
"@superliora/liora": patch
---

Fix Conductor jobs stuck at "Queued after resume" after a session restart by publishing the main agent before fleet autopilot spawns and waiting for the schedule pump to promote workers.
