Live Kanban board for multi-step work — use proactively and often when progress tracking helps. Update when the shape of work changes. In plan mode, write the durable plan to the plan file; use TodoList only as the execution board.

**Use when:** multi-step tasks, large searches, edit sequences, 2+ file edits, test→fix loops, swarm orchestration.
**Skip when:** one–two call tasks, trivial or conversational replies.

**Input (strict):** `todos` is an array of `{ "title": string, "status": "pending"|"in_progress"|"done" }` only. Any other field/status is rejected.

```jsonc
// Full replace
{ "todos": [
  { "title": "Patch session-handler.ts", "status": "in_progress" },
  { "title": "Run auth.test.ts", "status": "pending" }
] }
// Query current list — omit todos entirely
{}
// Clear — empty array
{ "todos": [] }
```

**Replace semantics:** every write replaces the full board. Send changed + unchanged items, or you clobber in-progress work.

**Start:** for 3+ step work, create the board before the first tool call (5–10 actionable cards).

**Update when (not churn):** (1) new sub-work, (2) switching `in_progress`, (3) mark done immediately after finishing a tracked task when fully verified — not when tests are failing or work is partial, (4) after a batch of 3+ tool calls, (5) scope or priority change. If nothing changed, query mode (omit `todos`).

**Granularity:** verb + target (+ path). Split vague cards into inspect/patch/test/verify. Keep exactly one `in_progress` unless real parallel tracks exist.

**Avoid churn:** do not re-call when nothing meaningful has changed since the last write. When unsure, use query mode first (no `todos` argument). If stuck, tell the user instead of reordering endlessly.
