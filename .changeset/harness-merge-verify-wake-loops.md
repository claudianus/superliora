---
"@superliora/liora": minor
---

Cut Conductor merge/verify/wake loops: inert probe-fail siblings no longer block merge, verify uses a live model different from the maker (or skips enqueue), missing dual-axis JSON does not re-spawn verify, workers pre-abort when verification_commands stall, and wake routes digest 1 + highest-severity JobInspect 1 only.
