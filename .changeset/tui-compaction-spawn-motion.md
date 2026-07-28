---
'@superliora/liora': minor
---

Add clock-driven motion cues to TUI compaction progress and subagent spawn surfaces.

- Compaction progress: the in-flight progress line now carries a shimmer activity marker ahead of the phase label, and the live summary preview cursor blinks on the shared animation clock. Both cues disappear with the progress line when compaction settles.
- Subagent spawn: freshly appearing subagent surfaces get a bounded highlight entrance settle — the single Agent card header and the multi-subagent `↳` chip row. First-seen guarded so re-renders and streaming remounts decay the settle in place instead of replaying it; replayed history never animates.
- Quality gates unchanged: motion off / SSH / NO_COLOR / CI render both surfaces byte-identical and static.
