---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/plan/work-graph-from-plan pure helpers regression cases

- `parseWorkGraphNodesFromPlan` covers missing WorkGraph section,
  markdown table parsing, stage synonyms (`implementation`/`review`),
  bullet fallback, invalid-stage bullet rejection, and section boundary
  on the next top-level heading.
- `formatSeededWorkGraphNotice` covers unseeded / empty-nodes cases and
  full notice formatting with explicit and fallback run ids.
