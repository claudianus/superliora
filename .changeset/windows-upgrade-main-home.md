---
"@superliora/liora": patch
---

Fix `liora upgrade --main` on Windows so a source checkout writes the command to `%LOCALAPPDATA%\SuperLiora\bin` when Git Bash cannot see `liora`, and finds pnpm under `SUPERLIORA_HOME` instead of `~/.superliora`.
