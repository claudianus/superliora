---
"@superliora/liora": minor
---

New sessions auto-isolate into a git worktree (`~/.superliora/worktrees/`) so concurrent agents no longer share one dirty checkout. Opt out with `--no-worktree` or `SUPERLIORA_NO_WORKTREE=1`. Status bar and transcript also drop redundant model/route/compact noise that already has a dedicated surface.
