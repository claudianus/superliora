---
'@superliora/liora': minor
---

Settled Write/Edit tool previews now stage in line-by-line instead of appearing all at once. The reveal reuses the streaming reveal helpers and the shared animation clock, is capped at ~400ms (premium; subtle stretches calmer) regardless of line count, never replays on streaming-delta remounts, and stays off for history/resume cards and no-motion environments (quality off / SSH / NO_COLOR / CI render byte-identical output).
