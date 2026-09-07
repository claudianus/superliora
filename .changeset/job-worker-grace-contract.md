---
"@superliora/liora": patch
---

Clarify the job-worker finishing-grace contract: the one-shot re-arm extends the hard wall-clock deadline for whatever child is still running at it, so it is a bounded extension (wedged children still die at deadline + grace), not a `last_phase` gate. Adds lifecycle tests for the re-arm and the plain-guillotine path.
