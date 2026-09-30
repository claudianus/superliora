---
"@superliora/liora": patch
---

Keep a UTF-16 file in UTF-16 when it is rewritten, instead of converting it to UTF-8 without a mark (which Windows PowerShell 5.1 reads as ANSI), and refuse to append into one instead of writing UTF-8 bytes into it.