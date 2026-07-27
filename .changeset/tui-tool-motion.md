---
'@superliora/liora': minor
---

Tool call cards now move on state changes: a freshly started tool header settles in with a brief brand highlight, and the status mark flashes then settles to its success/error tone when a result lands instead of snapping. Session errors and warnings surfaced as status lines get a finite enter→exit emphasis (flash → shimmer → fade → static) driven by the shared animation clock. All three cues follow the appearance quality levels and stay off under SSH / NO_COLOR / CI.
