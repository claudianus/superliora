---
"@superliora/liora": minor
---

`/goal` on Conductor no longer runs the goal loop on the interactive lane. It opens a Goal Desk Job plus a goal-driver worker; status, pause, resume, and cancel follow that binding. The chat lane stays free while the worker pursues the objective.

Run `/goal <objective>` as usual; use `/goal status` to inspect the offloaded Jobs.
