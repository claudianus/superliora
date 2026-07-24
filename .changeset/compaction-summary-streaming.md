---
'@superliora/liora': minor
---

Stream the compaction summary live in the TUI. The summarizer's output now appears as it is generated (a dimmed tail preview in the compaction block) instead of a silent blocking wait, so long compactions show progress in real time. The preview clears once compaction settles.
