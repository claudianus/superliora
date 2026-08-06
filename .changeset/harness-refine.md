---
"@superliora/liora": minor
---

Add the /refine command and a Refine tool so the agent can review its own trajectory and apply small harness edits (prompt notes, memory, skills, subagent specs) with rollback support. Run /refine to trigger a pass, /refine status to inspect the harness state, and /refine rollback to undo the last change.

Refinement also runs on its own: every 25 turns (and after compactions) a cheap review-gate model decides whether the recent trajectory holds a reusable lesson, and only then does a full refine pass apply edits — at most one auto attempt per 20 minutes, main agent only. No manual command needed; disable with SUPERLIORA_EXPERIMENTAL_AUTO_REFINE=false.

Refinements are measured, not just applied: when a goal gate reaches a terminal outcome (pass or retry-exhausted), every active harness entry is scored, and an entry whose gate failures outpace its confirmations (2+ more failures) is automatically rolled back. /refine status shows each entry's gate score.
