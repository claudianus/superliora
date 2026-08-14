---
"@superliora/liora": patch
---

Keep long session resume/replay from freezing the TUI by always applying the transcript turn window during hydrate and bounding replay projection before mount.

Previously `trimTranscriptWindow` returned early while `isReplaying`, so resume of a long history rebuilt the entire transcript tree every paint. The sliding window now resolves a positive finite cap for replay (even when the live window is disabled), skips hysteresis during hydrate, and `limitReplayRecordsByTurn` remains the pre-projection bound so full-history layout never runs on the input/paint path.
