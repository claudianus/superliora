List background tasks and status for shell tasks and other background work. Re-enumerate after compaction instead of guessing task IDs.

Default `active_only=true`; `active_only=false` for finished (may include `lost` tasks). `limit` 1–100, default 20. Read-only; safe in plan mode. Use `TaskOutput` for output.
