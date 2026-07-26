---
"@superliora/agent-core": patch
---

test(agent-core): pin `extractEvidenceIdsFromText` identifier extraction

Durable identifiers (file hints, work node ids, liora-archived markers)
must survive compaction. If the extractor drops a category, the next
session can lose load-bearing context. Pin every branch with 8 regression
tests:

- `evidence_ids: a, b` form
- `evidence_id=x` form
- `evidence_ids="quoted"` form
- `work_node_ids` / `node_id` / `ac_id` / `acceptance_criterion_id` forms
- `[liora-archived id=…]` markers
- dedupe across repeated tokens
- length floor (single-letter noise filtered out)
- empty-list fallback for prose without identifiers
