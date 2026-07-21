---
'@superliora/liora': minor
---

Add a `/cron` command for scheduled job management

- `/cron list` (alias `ls`) asks the agent to show scheduled jobs via the CronList tool; `/cron delete <jobId>` removes a job via CronDelete; bare `/cron` prints usage.
- Scheduled jobs persist across sessions but had no command surface until now. The command delegates to the existing agent Cron tools, keeping the TUI layer thin.
