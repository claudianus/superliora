When `run_in_background=true`, the subagent runs detached. Completion arrives later as a synthetic user-role message — do not poll or predict; continue other work.

Default to foreground (omit `run_in_background`) when your next step needs its result. Use background only for independent work. Never background-launch then wait with `TaskOutput`.
