---
"@superliora/liora": patch
---

Fix the blank flickering transcript on TUI launch: paint Welcome before the first frame, keep Idle inside the viewport, and stop the splash from caching an empty transcript that /login then reused as a blank pane.
