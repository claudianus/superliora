---
"@superliora/liora": patch
---

Refresh two transitive dependencies past their open advisories. `brace-expansion` moves to 5.0.12 for the quadratic-time expansion in its `{a},b}` rewrite, and `ip-address` to 10.7.2 for the parse diagnostic that scales with input and the subnet comparison that could match addresses of different families. Both arrive through schema validation, and both ranges already allowed the newer releases, so this is a lockfile catch-up rather than a new requirement.
