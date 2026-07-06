List all cron jobs in this session (read-only, safe in plan mode).

Returns per task: `id` (for `CronDelete`), `cron`, `humanSchedule`, `prompt` (JSON, truncated 200 bytes), `nextFireAt` (post-jitter), `recurring`, `ageDays`, `stale` (recurring >7d — final fire then auto-delete; refresh via `CronCreate` with same `cron`+`prompt` from this list).

Empty: `cron_jobs: 0\nNo cron jobs scheduled.` Records separated by `---`. After compaction or when unsure of live ids, call this instead of guessing. Users cancel/modify through the model, not directly.
