---
"@superliora/liora": patch
---

Fix Windows install and first launch: PowerShell 5.1 can parse install.ps1, .cmd shims start, and LIORA_SHELL_PATH is honored for Git Bash.

Install and upgrade download Portable Git when Git Bash is missing so the agent shell can start.
