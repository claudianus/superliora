---
"@superliora/liora": patch
---

Fix `/goal` blocking when the cheap coding-chain models fail live probe: escalate to max/parent (e.g. the Conductor model), mark spawn as resumable `blocked`, and show `/model` + `/goal resume` on the Goal Monitor.
