---
"@superliora/liora": patch
---

Refuse to append into a UTF-16 file instead of writing UTF-8 bytes into it, which previously left the file unreadable.