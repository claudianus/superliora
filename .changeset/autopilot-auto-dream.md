---
"@superliora/liora": minor
---

Add the Liora Memory reflection scheduler, an autopilot issue-to-PR pipeline, and a structured diff code-review tool.

Liora Memory reflection (`SUPERLIORA_EXPERIMENTAL_AUTO_DREAM`): a cheap-gated background job promotes candidate records through deterministic duplicate and temporal-conflict checks. The canonical store owns the operation; no LLM rewrite or backup/rollback layer is involved.

Autopilot (`SUPERLIORA_EXPERIMENTAL_AUTO_PILOT`): a queue-based autonomous repo loop — ingest issues, run agent in a worktree, verify, open PR, retry on failure.

LioraReview: a built-in diff code-review tool that parses git diffs and reports findings (TODO/FIXME markers, empty catch blocks, console.log) with line numbers resolved deterministically from the diff hunks. Absorbed from alibaba/open-code-review.
