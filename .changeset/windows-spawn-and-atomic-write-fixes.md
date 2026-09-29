---
"@superliora/liora": patch
---

Fix Windows reliability: plugin language servers now start, atomic writes no longer open a data-loss window, the goal test gate can launch its runner, an interrupted ripgrep download repairs itself instead of breaking search for good, and a hook command is no longer mistaken for a directory.
