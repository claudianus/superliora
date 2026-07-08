---
"@superliora/liora": patch
---

Finish Ultrawork runs when `UpdateGoal complete` is called, even if the workflow checkpoint is still at an early stage such as `plan`. Sync the run forward to `learn` before marking it `done`, so goal completion no longer fails with a stage-skip error.
