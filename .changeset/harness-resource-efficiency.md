---
"@superliora/liora": patch
---

Trim long-session resource waste: file-rewind snapshots and terminal background-task output buffers are now capped and released instead of accumulating, journal drains serialize each record once instead of twice, OpenAI Responses streams accumulate tool-call arguments without per-delta re-copying, and per-request config logging drops redundant hashing. The `/ops` theatre stops refreshing as soon as the panel is dismissed.
