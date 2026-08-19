---
"@superliora/liora": patch
---

Fix source installs and `liora upgrade --main` failing on Windows with an unsupported Node engine error when the installer started from a Node that was not on PATH.

Report the pnpm or git error that actually failed an upgrade instead of whichever line happened to come last.
