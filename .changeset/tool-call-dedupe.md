---
"@superliora/liora": patch
---

Run the worker shell-command guard once per Bash call instead of twice with identical input, and parse a patch once per ApplyPatch call instead of once per phase.