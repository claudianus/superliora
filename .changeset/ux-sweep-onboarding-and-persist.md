---
"@superliora/liora": patch
---

Show the Command Hub with a short intro on first run so the search surface is discoverable, and write prompt-input state more efficiently: keystroke debounce no longer re-serializes the whole queued-message buffer on every pause, and the global input history file is trimmed only after it overshoots its cap instead of on every submit.
