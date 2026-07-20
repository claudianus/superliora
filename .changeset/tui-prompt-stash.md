---
"@superliora/liora": minor
---

Add Ctrl-X prompt stash: press Ctrl-X with a draft in the editor to set it aside (input mode included, so `!` shell drafts come back ready to run), and Ctrl-X again on an empty editor to restore the most recent stash. The stash is a per-session LIFO stack; toasts report how many drafts remain. Ctrl-X is listed in `/help`.
