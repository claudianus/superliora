Use this tool to maintain a live Kanban TODO list as you work through a multi-step task. Use it proactively and often when progress tracking helps the current work. Treat it like a working developer board, not a one-time outline. Update it when the shape of the work changes: after new evidence, after a blocker appears, after a task becomes unnecessary, after a task is split, and after each material completion. In plan mode, write the durable plan to the plan file; use TodoList only as the live execution board.

**When to use:**
- Multi-step tasks that span several tool calls
- Tracking investigation progress across a large codebase search
- Planning a sequence of edits before making them
- After receiving new multi-step instructions, capture the requirements as todos
- Before starting a tracked task, mark exactly one item as `in_progress`
- Immediately after finishing a tracked task, mark it `done`; do not batch completions at the end
- After discovering new work, add a concrete pending card instead of hiding it in prose
- When a pending card no longer matters, delete it from the replacement list instead of leaving stale work
- When a card is too vague, replace it with the next concrete action or split it into smaller cards
- When priorities change, reorder the pending cards so the next executable work is near the top

**When NOT to use:**
- Single-shot answers that complete in one or two tool calls
- Trivial requests where tracking adds no clarity
- Purely conversational or informational replies

**Live Kanban hygiene:**
- Keep the board small and useful. Prefer 3-7 cards for normal work; use more only when the task genuinely needs it.
- Keep at most one `in_progress` card unless the user explicitly asked for parallel tracks or a background task is genuinely running.
- Titles should name the real next action and concrete target, such as "Patch plan-mode Bash allowlist" or "Run todo-panel tests".
- Preserve useful `done` cards as evidence while work is active, but prune obsolete pending cards instead of carrying them forever.

**Avoid churn:**
- Do not re-call this tool when nothing meaningful has changed since the last call — update the list only after real progress.
- When unsure of the current state, call query mode first (omit `todos`) to check the list before deciding what to update.
- If no available tool can move any task forward, tell the user where you are stuck instead of repeatedly re-ordering the same todos.

**How to use:**
- Call with `todos: [...]` to replace the full list. Statuses: pending / in_progress / done.
- Call with no `todos` argument to retrieve the current list without changing it.
- Call with `todos: []` to clear the list.
- Keep titles short and actionable (e.g. "Read session-control.ts", "Add planMode flag to TurnManager").
- Update statuses as you make progress.
- When work is underway, keep exactly one task `in_progress`.
- Only mark a task `done` when it is fully accomplished.
- Never mark a task `done` if tests are failing, implementation is partial, unresolved errors remain, or required files/dependencies could not be found.
- If you encounter a blocker, keep the blocked task `in_progress` or add a new pending task describing what must be resolved.
