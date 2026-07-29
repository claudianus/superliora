Set current goal status — resume, end, or yield autonomous work.

- `active` — resume paused/blocked when the user asks to continue.
- `complete` — objective satisfied and validation passed; ends with a completion summary.
- `blocked` — external condition or required user input prevents progress. Not for hard/slow/uncertain work — only genuine impasse.
- `paused` — set aside for later resume.

Call `complete` only when all required work is done and no useful next action remains — not after only a plan/summary/partial result. After `blocked`, explain the blocker.
