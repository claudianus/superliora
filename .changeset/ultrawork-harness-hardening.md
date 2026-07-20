---
"@superliora/liora": minor
---

Harden the Ultrawork harness state machine and add loop-engineering observability.

- Fix premature run completion when WorkGraph is undefined or empty
- Fix cancel path to restore prior plan/swarm/premium state
- Fix extractUltraworkRunLines to collect indented key=value lines
- Add error logging and async propagation to stage advance and finish paths
- Prevent duplicate stageHistory entries and use atomic writes for workflow reports
- Extract shared LLM classifier utilities with a 10-second timeout on all classifier calls
- Cap plan directory scan to 20 most recent files
- Emit ultrawork_stage_change and ultrawork_resume telemetry with stage duration and oscillation detection
- Strengthen verify stage continuation guidance with a structured checklist
- Clip compaction envelope objective to 200 characters
