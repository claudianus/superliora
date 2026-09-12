---
"@superliora/liora": patch
---

Fix GLM ZCode login stalling when the ZCode desktop app grabs the one-time code: the paste dialog now warns to cancel the app-open prompt, and a consumed code restarts the login with a fresh authorize link instead of retrying a dead code.
