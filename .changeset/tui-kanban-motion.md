---
'@superliora/liora': minor
---

The kanban todo board now animates rearrangement: cards that change lane or row get a directional slide-and-fade transition (▴/▾ cue, decaying cell-local indent, brand title fade), cards entering the visible window get an entrance settle, and lane counts briefly re-flash in their header tone when they change. All cues run on the shared appearance clock and follow the quality levels — off / SSH / NO_COLOR / CI render byte-identical static frames. Frames rendered while cues are active are no longer memoized, so flashes settle to resting bytes the moment their window expires instead of lingering to the next second boundary.
