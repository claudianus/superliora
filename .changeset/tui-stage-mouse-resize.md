---
'@superliora/liora': minor
---

Make the TUI stage resizable with the mouse and larger by default on wide terminals. The stage panel now caps at 105×55 cells (up from 90×60) so fullscreen sessions show more of the transcript. You can drag any edge or corner of the stage frame to resize it live; the panel stays centered as it grows or shrinks, and the size is clamped to the visible terminal area (minimum 24×8). Dragging from the stage interior still selects transcript text as before.
