---
"@superliora/liora": patch
---

Show a confirm toast before inserting a very large paste into the editor; paste again to insert it for real. This keeps a giant log paste from freezing the editor or being sent to the model by a stray Enter. Ctrl-S now steers only the editor text and leaves queued messages queued, Ctrl-R history search works mid-turn and opens seeded with the current draft, and the footer shows a session cost badge so spend stays visible on terminals too narrow for the header segment.
