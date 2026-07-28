---
'@superliora/liora': minor
---

Add a live code-write pulse to UltraSwarm member cells: when a member's latest tool activity is Write/Edit, its grid cell shows a clock-driven ✎ pulse and a brand-tone action line, so several members writing code in parallel are visible at a glance. The mark clears on a non-write tool, an error result, a terminal phase, or a short quiet window, and adds no bytes when ambient motion is gated (off / SSH / NO_COLOR / CI).
