---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/compaction/context-helpers.ts pure-helper regression cases

- `usefulRecallItems` — pins the undefined filter, case-insensitive dedup, prompt-control / useless-item drop, and 8-item cap.
- `formatRecallSections` / `formatStringList` — pins the empty-skip, 8 / 12 caps, and `- None captured during compaction.` fallback marker.
- `recallSubject` / `recallTags` — pins the `\`*_#` strip, 80-char slice, empty-detail prefix fallback, and Set-union tag merge.
- `extractSwarmRunLines` / `extractNextActions` — pins the `swarm_runs:` bullet capture, the `Next steps` / `Todo` / `Pending` / `Active issues` heading switch, and the heading-terminator semantics.
- `mergeStringLists` / `uniqueSorted` / `uniqueHints` / `normalizeHint` / `isUsefulHint` — pins whitespace collapse, 200-char slice, dedup-after-normalize, and the empty-marker / heading / lone-`**label**:` rejections.
- `extractFileHints` — pins backtick + bare path capture, dedup, sort, and the supported-extension allow-list.
- `formatRawRef` — pins the `kind[start-end] tokens=N tools=a,b` rendering with and without `toolNames`.
- `factsToDetails` — pins the per-fact detail projection.
