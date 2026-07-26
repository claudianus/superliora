---
"@superliora/agent-core": patch
---

fix(agent-core): correct `onContextCompacted` post-compaction index for `DynamicInjector`

The new history is `[...keptMessages, summaryMessage, ...retainedSuffix]`, so a
retained-tail message at original index `N` (`N >= compactedCount`) now lands at
`keptMessages.length + 1 + (N - compactedCount)`. The previous formula
`injectedAt - compactedCount + 1` ignored `keptMessages.length`, which caused
every `DynamicInjector` to underestimate its injection's new position by the
number of kept head messages — `shouldRefresh` could fire on turns that did not
actually advance past the injection (re-injection is idempotent so this was
correctness-safe but wasted turns). `onContextCompacted` now accepts a
`keptHeadCount` parameter that the compaction site forwards from
`selection.head.length`. The legacy single-arg call is preserved for callers
that pass `0`.
