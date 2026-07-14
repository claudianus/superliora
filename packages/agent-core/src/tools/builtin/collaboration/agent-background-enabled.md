When `run_in_background=true`, the subagent runs detached. Completion arrives later as a synthetic user-role message — do not poll, sleep, or predict the result; continue other work.

Default to a foreground subagent (omit `run_in_background`) when your next step needs its result. Use background only for independent work you do not need to proceed. Never background-launch then immediately wait with `TaskOutput` — run foreground instead.
