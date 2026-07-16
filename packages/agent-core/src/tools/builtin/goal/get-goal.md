Read the current goal: objective, completion criterion, status, and budgets (turns/tokens/time and remaining). When stopped, also reports the terminal reason.

Use `GetGoal` before deciding whether to continue, report a completion/blocker, or respect a pause. Returns `{ "goal": null }` when there is no current goal.
