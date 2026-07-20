---
"@superliora/liora": minor
---

Add `/blame <path>`: show git blame attribution for a file in a scrollable TUI panel. Each line gets a gutter with the short hash, author, and date; uncommitted lines are highlighted. Parses `git blame --porcelain` with commit caching, so large files stay fast.
