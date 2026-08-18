---
'@superliora/liora': patch
---

`liora upgrade` now auto-installs updates for GitHub checkout installs on Windows. The updater locates Git for Windows' bash.exe (never the System32 WSL launcher), runs the checkout update script through it, and passes the running Node directory on PATH so the script can rebuild. When Git Bash is not installed, the manual update command is still shown.
