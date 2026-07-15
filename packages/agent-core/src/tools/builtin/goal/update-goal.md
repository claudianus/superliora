Set current goal status — resume, end, or yield autonomous work.

- `active` — resume paused/blocked when the user explicitly asks to work on it.
- `complete` — objective satisfied and validation passed; ends with a completion summary.
- `blocked` — external condition or required user input prevents progress, or the objective cannot be completed as stated. Not for hard, slow, or uncertain work — only genuine impasse.
- `paused` — set aside; can resume later.

If active and you do not call this, the goal keeps running. Call `complete` only when all required work is done and no useful next action remains — not after only a plan, summary, first pass, or partial result. After `blocked`, explain the blocker. Status is machine-readable; write summary/blocker prose yourself.
