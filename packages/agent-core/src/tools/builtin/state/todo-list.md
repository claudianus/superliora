Live Kanban for multi-step work — use proactively when tracking helps. Update when the work shape changes. In plan mode, write the durable plan to the plan file; TodoList is the execution board only.

**Use when:** multi-step tasks, 2+ file edits, test→fix loops, swarm orchestration. **Skip when:** one–two call tasks or pure conversation.

**Input (strict):** `todos` is `{ "title", "status": pending|in_progress|done }[]` only. Other fields/statuses rejected. Omit `todos` (no `todos` argument) to query; `[]` clears.

**Replace semantics:** every write replaces the whole board — keep still-active unchanged items.

**Start:** for 3+ step work, create 5–10 actionable cards before first tool call.

**Update when (not churn):** (1) new sub-work, (2) switching `in_progress`, (3) mark done immediately when complete, (4) drop cancelled items. Do not rewrite the board every turn.

**Rules:** exactly one `in_progress` when possible; keep titles short and actionable; never invent statuses.
