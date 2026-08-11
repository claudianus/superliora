---
"@superliora/liora": patch
---

Fix MergeJob held on `Checks not green` for greenfield apps: root packages run the completion gate, `build` counts as typecheck, missing scripts are `not_applicable`, and a passed verify child can witness green when the gate left slots `not_run`.
