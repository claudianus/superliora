---
"@superliora/agent-core": patch
---

test(agent-core): lock in the post-compaction `injectedAt` shift across injectors

`onContextCompacted(compactedCount, keptHeadCount)` is the new lifecycle hook
the compaction site calls with `selection.head.length`. The companion commit
fixed the off-by-one; this commit adds regression tests that pin the math
across the three lifecycle-driven injectors so a future change cannot silently
regress the position math:

- `LeanContextInjector` — pin the shift and the "compaction beyond the
  injection clears the marker" path.
- `ResponseLanguageInjector` (new test file) — same shift pinning plus the
  throttling behaviour that depends on the corrected index.
- `ToolWorkflowInjector` — same shift pinning, with a second compaction
  showing the index moves by the new head count rather than zero.

The tests assert directly on `injectedAt` after `onContextCompacted` so the
throttling logic itself does not need to be re-derived to catch the bug.
