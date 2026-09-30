---
"@superliora/liora": patch
---

Fix terminal and shell handling on Windows: stop trusting a POSIX-spelled `$SHELL`, keep the `Path` spelling the system uses, and keep core environment names spelled the way Windows spells them.