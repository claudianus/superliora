---
'@superliora/agent-core': patch
---

Coerce stringified scalar tool arguments (e.g. `line_offset: "96"`) toward their declared JSON Schema type during AJV validation. Fixes tools whose numeric parameters sit inside `anyOf` unions — such as Read's `line_offset` — being rejected with `must be integer` when the model emits them as strings.
