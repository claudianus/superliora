---
"@superliora/liora": patch
---

Fix Korean (and other CJK) IME composition text appearing at the wrong screen position. The renderer now re-emits the terminal cursor position on every frame so the OS IME renders the composition window at the editor caret instead of drifting to the bottom of the screen.
