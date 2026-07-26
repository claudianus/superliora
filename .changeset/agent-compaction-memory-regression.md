---
"@superliora/agent-core": patch
---

test(agent-core): pin `agent/compaction/memory.ts` parsing and guard helpers

The compaction-memory helpers decide what gets re-injected into the next
session and what gets dropped. Pin the behaviour with 14 regression
tests covering:

- `isPlaceholderCompactionMemoryItem` empty / `none` / `N/A` / `None
  captured during compaction.` / `Not captured during compaction.` /
  `No captured item.` and benign content
- `isUsefulCompactionMemoryItem` placeholder + heading + category-only
  bullet (`**file**: `) rejection and benign content acceptance
- `isPromptControlCompactionMemoryItem` ignore/override/exfiltration/
  treat-as-system detection and benign content acceptance — the
  prompt-control guard must catch all three attack classes
- `parseStructuredCompactionMemory` full-section parsing (every key
  including `currentGoal`), dedupe, and empty-summary behaviour
- `mergeFactSets` union + per-category subject dedupe with importance
  promotion (critical wins over important) and empty-input fallback

The prompt-control guard is the most safety-critical: a future regex
rewrite that drops a category would let an attacker slip
instruction-override phrases through a compaction summary.
