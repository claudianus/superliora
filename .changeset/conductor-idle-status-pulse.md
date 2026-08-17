---
"@superliora/agent-core": patch
"@superliora/liora": patch
---

When Jobs are running and the main chat lane stays idle for N minutes (default 4; SUPERLIORA_CONDUCTOR_IDLE_PULSE_MINUTES), fire a short JobList-only status report. Spam guards skip busy turns, unread inbox (desk wake owns that path), consecutive pulses, and recent activity. Terminal job_desk_wake is unchanged.
