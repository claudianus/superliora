---
"@superliora/liora": patch
---

Project checks now run the declared canonical script verbatim and honor caller-provided script overrides instead of guessing script names; checks that cannot be resolved are recorded as undecidable rather than silently passed.
