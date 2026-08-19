---
"@superliora/liora": patch
---

Fix `liora upgrade --main` failing right after the build on Windows because the installer would not replace the command wrapper left by a prebuilt install.
