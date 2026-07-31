---
"@superliora/liora": patch
---

Headless `liora -p` runs now emit `runtime.degraded` on the session event stream when proactive OAuth refresh fails, matching the Never-Halt contract used by the interactive TUI.
