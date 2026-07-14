Set the status of the current goal — resume, end, or yield autonomous goal work.

- `active` — resume a paused/blocked goal when the user explicitly asks to work on it.
- `complete` — objective satisfied and any stated validation passed. Ends the goal and records a completion summary.
- `blocked` — external condition or required user input prevents progress, or the objective cannot be completed as stated. Not for hard, slow, or uncertain work — only genuine impasse.
- `paused` — set aside for now; can resume later.

If the goal is active and you do not call this, it keeps running after your turn. Call `complete` only when all required work is done, validation passed, and no useful next action remains — not after only a plan, summary, first pass, or partial result. After `blocked`, explain the blocker next. Status is machine-readable; write the summary/blocker prose yourself.
