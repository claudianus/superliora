---
"@harness-kit/tui-renderer": patch
"@superliora/liora": patch
---

Speed up ambient fullscreen frames: swap present buffers without re-normalizing every cell, and skip composition row-key work while time-varying stage VFX is active.
