---
"@superliora/agent-core": patch
---

Use `Array#toSorted()` instead of copy-then-`sort()` in the research search provider slot ordering, clearing the remaining oxlint `no-array-sort` warnings with identical semantics.
