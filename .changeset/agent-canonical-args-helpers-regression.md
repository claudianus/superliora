---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/turn/canonical-args helpers regression cases

- `isPlainRecord` — pin the rejection of `null`, `undefined`, primitives, and arrays, the acceptance of plain objects and `Object.create(null)` records, and the rejection of class instances / `Date` / `RegExp` / `Map`.
- `canonicalTelemetryArgs` — pin the alphabetical sort of top-level keys, the recursive sort of nested object keys (including inside arrays of plain records), the passthrough of primitives / `null`, the preservation of array order for primitive values, and the key-sort inside an array of plain objects.
