---
"@superliora/liora": patch
---

`liora -p` and the TUI no longer block startup on the worktree registry read that only bumps a GC timestamp, so the first token arrives without waiting on disk. Job Deck token usage now flows through the single `appState.conductorJobs` writer instead of patching state from the pane controller, and the re-injected tool-workflow checkpoint drops a line the stop sensor already raises.
