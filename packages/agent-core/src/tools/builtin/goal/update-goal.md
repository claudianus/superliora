Set current goal status — resume, end, or yield autonomous work.

- `active` — resume paused/blocked when the user explicitly asks to continue it.
- `complete` — objective satisfied and validation passed; ends with a completion summary.
- `blocked` — external condition or required user input prevents progress, or the objective cannot be completed as stated. Not for hard/slow/uncertain work — only genuine impasse.
- `paused` — set aside; can resume later.

If active and you do not call this, the goal keeps running. Call `complete` only when all required work is done and no useful next action remains — not after only a plan/summary/first pass/partial result. After `blocked`, explain the blocker. Status is machine-readable; write the summary/blocker prose yourself.
