---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/compaction/render-messages.ts and handoff-collapse.ts regression cases

- `renderMessagesToText` — pins the multi-message join, empty content marker, header attribute emission (name/toolCallId/partial), text/think/media parts, parsed JSON arguments, malformed JSON pass-through, `null` arguments, `extras` with bigint, `[Circular]` cycle marker, and the unknown-content-kind fallback branch.
- `collapseForHandoff` — pins the under-cap pass-through, whitespace run collapse, at-cap equality, over-cap slice + `'...'` (default and custom `maxChars`), inclusive threshold semantics (`<=` keeps verbatim, `> maxChars-3` adds the ellipsis), and the documented `SWARM_EXPERT_BODY_MAX_CHARS` / `SWARM_ARCHIVED_INLINE_SUMMARY_MAX_CHARS` constants (1_600 / 120, with the inline summary strictly below the body cap).
