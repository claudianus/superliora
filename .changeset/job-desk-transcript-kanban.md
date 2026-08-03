---
"@superliora/liora": minor
---

Retire the Conductor control-tower full-screen takeover (including the
boot-time default screen) and render the Job Desk as a kanban panel inside
the transcript screen, below the Todo board. The prompt input and
transcript stay available at all times; lanes (Needs you / Running /
Queue / Closed) update live from `job.*` events, and `/jobs board` now
toggles the panel's visibility.
