Live Kanban board for multi-step work — use proactively and often when progress tracking helps. Update when the shape of work changes. In plan mode, write the durable plan to the plan file; use TodoList only as the execution board.

**Use when:** multi-step tasks, large searches, edit sequences, new multi-step instructions.
**Skip when:** one–two call tasks, trivial or conversational replies.

**Hygiene:** 3–7 cards normally; keep exactly one `in_progress` unless parallel tracks are real. Mark `done` immediately after finishing a tracked task when fully verified — not when tests are failing or work is partial.

**Avoid churn:** do not re-call when nothing meaningful has changed since the last call — update only after real progress. When unsure, use query mode first (no `todos` argument). If stuck, tell the user instead of reordering endlessly.

**API:** `todos: [...]` replaces the list (`pending` / `in_progress` / `done`); omit `todos` to read; `todos: []` clears.
