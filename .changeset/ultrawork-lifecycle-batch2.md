---
"@superliora/liora": patch
---

Unify the Ultrawork setup/rollback/finish logic into one module so the TUI, /goal, and headless paths no longer drift: headless and /goal runs now enable Premium Quality like the TUI does, and finishing a run restores the plan/swarm/premium state the session had before it started instead of forcing everything off. Also fix the footer workflow order to put research before the interview, matching the Ultrawork contract.
