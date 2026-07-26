---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/permission/policies/file-access-ask.fileAccesses regression cases

- `fileAccesses` — pin the empty-list return when `execution.accesses` is `undefined` or an empty array, the filter that drops non-`file` access kinds (`all`, `http`), and the verbatim pass-through of `file` access entries (no path-type filter at the helper level).
