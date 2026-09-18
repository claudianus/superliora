---
"@superliora/liora": patch
---

Refuse installer writes to paths that are not absolute on the host, so a relative or foreign-style install home cannot drop stray directories into the working directory.
