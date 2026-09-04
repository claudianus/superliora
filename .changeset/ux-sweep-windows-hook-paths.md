---
"@superliora/liora": patch
---

Fix shell-form hooks silently failing on Windows when the executable path contains spaces: a `node.exe` under `C:\Program Files` was cut at the first space, so PreToolUse blocking hooks always allowed. Spaced executables now spawn directly as argv[0].
