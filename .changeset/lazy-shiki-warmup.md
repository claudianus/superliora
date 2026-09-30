---
"@superliora/liora": patch
---

Start the CLI about 200ms faster on macOS and Linux by loading the syntax highlighter only when a code block is rendered, not at startup.