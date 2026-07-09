---
"@superliora/liora": minor
---

Add auto-dream background memory consolidation, an autopilot issue-to-PR pipeline, and a structured diff code-review tool — all gated behind experimental flags (default off).

Auto-dream (`SUPERLIORA_EXPERIMENTAL_AUTO_DREAM`): after each user turn, a cheap-gated background job asks the LLM to semantically cluster and merge long-term-memory records, backing up the store first and rolling back on failure.

Autopilot (`SUPERLIORA_EXPERIMENTAL_AUTO_PILOT`): a queue-based autonomous repo loop — ingest issues, run agent in a worktree, verify, open PR, retry on failure.

LioraReview: a built-in diff code-review tool that parses git diffs and reports findings (TODO/FIXME markers, empty catch blocks, console.log) with line numbers resolved deterministically from the diff hunks. Absorbed from alibaba/open-code-review.
