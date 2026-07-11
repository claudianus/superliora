Live Kanban board for multi-step work — use proactively and often when progress tracking helps. Update when the shape of work changes. In plan mode, write the durable plan to the plan file; use TodoList only as the execution board.

**Use when:** multi-step tasks, large searches, edit sequences, new multi-step instructions, 2+ file edits, test→fix loops, swarm orchestration.
**Skip when:** one–two call tasks, trivial or conversational replies.

**Input shape (strict):** `todos` is an array of objects with exactly two required string fields — `title` (non-empty) and `status` (one of `"pending"`, `"in_progress"`, `"done"`). No other fields are accepted. Every item must carry both fields; omitting either or passing any other status value (e.g. `"default"`, `"wip"`, `"completed"`, `"todo"`) is a validation error and the call is rejected.

```jsonc
// Correct — full replace
{ "todos": [
  { "title": "Patch session-handler.ts", "status": "in_progress" },
  { "title": "Run auth.test.ts", "status": "pending" }
] }
// Query current list — omit todos entirely
{}
// Clear the list — empty array
{ "todos": [] }
```

**Replace semantics:** `todos` replaces the entire list every call — there is no partial patch. Send the full board (changed + unchanged items) on each write, or you will clobber in-progress work.

**Start:** For 3+ step work, create the board **before your first tool call** — seed 5–10 actionable cards from the request.

**Update when (not churn):** write after any of — (1) newly discovered sub-work, (2) switching `in_progress`, (3) verified completion → `done`, (4) finishing a batch of 3+ tool calls, (5) scope or priority change. If nothing changed, use query mode (omit `todos`) instead of re-calling.

**Granularity:** Split vague cards ("fix bug") into inspect / patch / test / verify. One card per file, module, or verification step when practical. Titles: verb + target + optional path — e.g. `Run auth.test.ts`, `Patch session-handler.ts`. Parallel tracks: prefix titles — `[auth]`, `[ui]`.

**Hygiene:** 5–10 cards normally; keep exactly one `in_progress` unless parallel tracks are real. Mark `done` immediately after finishing a tracked task when fully verified — not when tests are failing or work is partial.

**Avoid churn:** do not re-call when nothing meaningful has changed since the last call. When unsure, use query mode first (no `todos` argument). If stuck, tell the user instead of reordering endlessly.

**API:** `todos: [{ "title": string, "status": "pending" | "in_progress" | "done" }]` replaces the list; omit `todos` to read; `todos: []` clears.
