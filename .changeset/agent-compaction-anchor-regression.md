---
"@superliora/agent-core": patch
---

test(agent-core): pin `agent/compaction/anchor.ts` document lifecycle

The anchor document persists across compactions and carries the agent's
intent, changes, decisions, and next steps. Pin the lifecycle with 9
regression tests:

- `createAnchorDocument` seeds intent and leaves arrays empty
- `mergeIntoAnchor` appends and dedupes per section, keeps the original
  intent when the diff has none, overrides the intent when the diff
  supplies one, and caps each list at the documented limit (30/20/10)
- `renderAnchor` returns an empty string when no body content is present
  and renders intent + changes + decisions + next steps with stable
  section headings
- `extractAnchorDiff` parses changes / decisions / next steps from a
  summary and returns an empty diff for prose without anchor sections
