Set current goal status — resume, end, or yield autonomous work.

- `active` — resume paused/blocked when the user asks to continue.
- `complete` — objective satisfied and validation passed; ends with a completion summary.
- `blocked` — genuine external impasse only. Requires `reason` naming the concrete blocker (missing credentials/approvals, permission deny, no write access, unreachable externals, contradictory goals). Not for hard/slow/uncertain work, calendar size, or "too large / impossible / cut scope".
- `paused` — honest yield for later resume (`reason` optional). Do not pause with magnitude/calendar/scope-escape reasons — that is the same stall as a fake `blocked`.

Call `complete` only when all required work is done and no useful next action remains — not after only a plan/summary/partial result. After `blocked`, explain the blocker in the user-facing reply too.
