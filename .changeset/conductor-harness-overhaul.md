---
"@superliora/liora": minor
---

Close the Conductor harness feedback loop and tighten what it reports.

- Terminal job notices now wake the Conductor for a single routing pass, so a finished worker is relayed, verified, and chained without you asking for a status report first.
- Closing a session marks in-flight jobs `interrupted` instead of leaving them stuck in `running`, so `/job resume` has something to restore.
- Job cards show live worker activity (current phase, recent tools, steps) by joining subagent progress in the TUI.
- `MergeJob` now reads its trust inputs from the ledger's verification contract; tool arguments can only make a verdict stricter, never looser.
- A job that completes without running its checks is labelled `unverified` instead of reading like a passing `done`, and it no longer qualifies for merge auto-approval.
- `explore` and inbox-digest jobs skip worktree creation — the read-only profile has no write tools, and running in the main checkout also lets them see uncommitted work.
- Spawn concurrency now follows the job concurrency setting, so promoted jobs no longer sit in `running` waiting for a spawn slot.
- Leaner Conductor context: situational guidance moved into the job desk injection, plan-phase tools left the whitelist, job notes are capped, and `JobInspect` renders a compact summary instead of a full JSON dump.
