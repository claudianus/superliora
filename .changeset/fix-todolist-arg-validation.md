---
"@superliora/liora": patch
---

Teach the TodoList tool to reject malformed args early so the model stops looping on shape mistakes. The tool description now spells out the exact input shape (`title` + `status` only, three allowed status values) with JSON examples and replace semantics, the item schema uses `strictObject` to reject smuggled extra fields, and `resolveExecution` returns a self-correcting error message when validation fails instead of crashing or silently storing partial data.
