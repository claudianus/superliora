Retrieve output from a background task after `Bash(run_in_background=true)` or `Agent(run_in_background=true)`.

Prefer automatic completion notifications. Do not use TaskOutput to wait when your next step depends on the result — run that task in the foreground instead. Default non-blocking; `block=true` to wait. Returns metadata, preview, and `output_path` (use `Read` for full log). Terminal: `completed` or `failed` with `exit_code`; `terminal_reason` for timeout/stop/error.
