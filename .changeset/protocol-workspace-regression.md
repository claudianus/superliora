---
'@superliora/protocol': patch
---

test(protocol): pin protocol/workspace zod schemas regression cases

- `workspaceIdSchema` accepts the canonical `wd_<slug>_<12-hex>` literal
  and rejects malformed / too-short / non-hex ids.
- `workspaceCreateSchema` accepts a minimal `{ root }` payload and
  rejects an empty root.
- `workspaceUpdateSchema` requires a non-empty name of at most 100 chars.
- `workspaceSchema` accepts a fully populated workspace and rejects a
  negative `session_count`.
