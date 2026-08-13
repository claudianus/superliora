---
"@superliora/liora": patch
---

Fix Windows install on PowerShell 5.1 (`irm | iex`) and accept the same command from cmd.exe.

powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/claudianus/superliora/main/install.ps1 | iex"
