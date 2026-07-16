Live Kanban for multi-step work — use proactively when tracking helps. Update when the work shape changes. In plan mode, write the durable plan to the plan file; TodoList is the execution board only.

**Use when:** multi-step tasks, large searches, edit sequences, 2+ file edits, test→fix loops, swarm orchestration. **Skip when:** one–two call tasks or pure conversation.

**Input (strict):** `todos` is `{ "title", "status": pending|in_progress|done }[]` only. Other fields/statuses rejected. Omit `todos` (no `todos` argument) to query; `[]` clears.

**Replace semantics:** every write replaces the whole board—include unchanged items still active.

**Start:** for 3+ step work, create 5–10 actionable cards before first tool call.

**Update when (not churn):** (1) new sub-work, (2) switching `in_progress`, (3) mark done immediately after finishing a tracked task when fully verified — not when tests are failing or work is partial, (4) after a batch of 3+ tool calls, (5) scope or priority change. If nothing changed, query mode (omit `todos`).

**Granularity:** verb + target (+ path). Keep exactly one `in_progress` unless true parallel tracks.

**Avoid churn:** do not re-call when nothing meaningful changed since last write. When unsure, query first (no `todos` argument). If stuck, tell the user — no endless reordering.
