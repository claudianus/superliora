---
"@superliora/liora": patch
---

Resume and MergeJob now heal verify Jobs that already have dual-axis JSON in the summary but never stamped `verifyVerdict`, so older Conductor sessions are not stuck after an upgrade.
