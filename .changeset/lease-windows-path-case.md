---
"@superliora/liora": patch
---

Fix file leases handing two workers separate leases for the same Windows file when their spellings differ in case, and stop a type import from breaking the package layering check.