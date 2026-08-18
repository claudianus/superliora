---
"@superliora/liora": patch
---

Fix TUI startup flicker and the provider picker opening on a black screen on Windows: palette colors are no longer re-sent on every splash frame, and the screen repaints fully after the splash ends or the terminal resizes.
