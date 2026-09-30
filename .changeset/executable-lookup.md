---
"@superliora/liora": patch
---

Fix tool lookup on Windows: a quoted PATH entry or a `.cmd`/`.bat` shim is now resolved, and a non-executable file with the same name is no longer mistaken for the tool.