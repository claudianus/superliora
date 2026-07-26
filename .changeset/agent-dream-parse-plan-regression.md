---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/dream/auto-dream regression cases

- `DREAM_BACKUP_SUFFIX` constant pin.
- `parseDreamPlan()` empty / invalid / missing-merges / valid / unknown-keeper /
  string-only-duplicateIds / non-object entry / first-JSON-object-from-prose
  branches.
