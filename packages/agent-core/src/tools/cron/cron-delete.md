Cancel a scheduled cron job by `id` (8-hex from `CronCreate` or `CronList`).

- Recurring: stops future fires immediately.
- One-shot pending: cancelled; already-fired one-shots auto-deleted (not-found error).

Not-found → call `CronList` for live ids. Stale recurring tasks auto-delete after final fire — recreate with `CronCreate` + `CronList`'s `prompt` field. Irreversible — re-create if wrong task deleted. Users must ask the model to cancel; confirm and report plainly.
