---
"@superliora/liora": minor
---

Add auto-dream background memory consolidation, an autopilot issue-to-PR pipeline, and a structured diff code-review tool — all gated behind experimental flags (default off).

Auto-dream (`SUPERLIORA_EXPERIMENTAL_AUTO_DREAM`): after each user turn, a cheap-gated background job asks the LLM to semantically cluster and merge long-term-memory records, backing up the store first and rolling back on failure.

Autopilot (`SUPERLIORA_EXPERIMENTAL_AUTO_PILOT`): a queue-based autonomous repo loop that ingests GitHub issues or manual ideas, scores them, runs the agent in an isolated git worktree, verifies (with a shell-injection-safe command gate), opens a PR, and retries on failure.
