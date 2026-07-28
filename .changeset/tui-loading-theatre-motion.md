---
'@superliora/liora': minor
---

Session picker and Ultrawork theatre pick up clock-driven motion cues:

- The session picker's `Loading sessions...` hint now carries a shimmer prefix while the session scan runs (off / SSH / NO_COLOR / CI keep the exact static hint).
- The Ultrawork theatre stage line plays a bounded settle flash on first sight and on every real phase change, then rests on the previous static bytes; duplicate stage events and ambient re-renders no longer restart the cue.

The session resume/replay loading overlay already animated (spinner, mini scene, pulsing bar), so it is unchanged.
