---
"@superliora/liora": patch
---

Fix the transcript going blank during long-running operations with styled labels (e.g. OAuth "Opening browser…" spinners). The transcript geometry estimator skipped ANSI escapes incorrectly — it stopped on the `[` of `ESC [` instead of consuming the full CSI sequence, so every SGR parameter byte was counted as a visible column. Per-character gradient text (loader labels that embed the authorize URL) measured ~30x taller than it renders, producing hundreds of phantom rows; the follow-bottom window then sliced empty space inside the phantom region and painted a blank transcript until more content arrived. The estimator now consumes CSI, OSC, and two-byte escape sequences correctly.
