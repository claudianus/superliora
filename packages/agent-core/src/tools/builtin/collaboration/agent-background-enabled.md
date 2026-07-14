When `run_in_background=true`, the subagent runs detached from this turn. Completion arrives later as a synthetic user-role message — do not poll, sleep, or predict the result; continue other work.

Default to a foreground subagent (omit `run_in_background`) when your next step needs its result. Use background only when you have independent work and do not need the result to proceed. Never background-launch and then immediately wait on it with `TaskOutput` — run foreground instead.
