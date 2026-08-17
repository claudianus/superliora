---
"@superliora/liora": patch
---

Stop TUI black-line flicker by giving every screen cell an explicit canvas background and never erasing a line to the terminal default color.
