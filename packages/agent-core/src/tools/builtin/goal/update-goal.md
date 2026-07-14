Set the status of the current goal — how you resume, end, or yield autonomous goal work.

- `active` — resume a paused/blocked goal when the user explicitly asks you to work on it.
- `complete` — objective satisfied and any stated validation passed. Ends the goal and records a completion summary.
- `blocked` — external condition or required user input prevents progress, or the objective cannot be completed as stated. Not for hard/slow/uncertain work — only genuine impasse.
- `paused` — set aside for now; can resume later.

If the goal is active and you do not call this, it keeps running after your turn. Call `complete` only when all required work is done, validation passed, and no useful next action remains — not after only a plan, summary, first pass, or partial result. After `blocked`, explain the blocker in the next message. Status is the machine-readable signal; the summary/blocker prose is yours to write next.
