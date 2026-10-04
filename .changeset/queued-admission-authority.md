---
"@superliora/liora": patch
---

Block queued work when workspace permission is revoked, and reject restored pipelines whose trusted configuration no longer matches their accepted ownership.

Keep pipeline operations separate from their caller's worker identity.
