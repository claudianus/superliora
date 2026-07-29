Live Kanban for multi-step work — use proactively when tracking helps. In plan mode, write the durable plan to the plan file; TodoList is the execution board only.

**Use when:** multi-step tasks, 2+ file edits, test→fix loops, swarm orchestration. **Skip when:** one–two call tasks or pure conversation.

**Input (strict):** `todos` is `{ "title", "status": pending|in_progress|done }[]` only. Omit `todos` to query; `[]` clears. Every write replaces the whole board — keep still-active unchanged items.

**Start:** for 3+ step work, create 5–10 actionable cards before first tool call.

**Update when:** (1) new sub-work, (2) switching `in_progress`, (3) mark done after fully verified — not when tests fail or work is partial, (4) after 3+ tool calls, (5) scope change. If nothing changed, query mode (omit `todos`).

**Granularity:** verb + target (+ path). Keep exactly one `in_progress` unless true parallel tracks. Do not re-call when nothing meaningful changed.
